import {Message} from "@libp2p/interface";
import xxhashFactory from "xxhash-wasm";
import {digest} from "@chainsafe/as-sha256";
import {RPC} from "@chainsafe/libp2p-gossipsub/message";
import {DataTransform} from "@chainsafe/libp2p-gossipsub/types";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {LinkedList} from "../../util/array.js";
import {getMaxDataColumnSizeCarBytes} from "../../util/sszBytes.js";
import {MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants.js";
import {GossipType} from "./interface.js";
import {SnappyError, SnappyErrorCode} from "./snappy/error.js";
import {compress, uncompress} from "./snappy/index.js";
import {GossipTopicCache, getGossipSSZType} from "./topic.js";

// Load WASM
const xxhash = await xxhashFactory();

// Use salt to prevent msgId from being mined for collisions
const h64Seed = BigInt(Math.floor(Math.random() * 1e9));

// Shared buffer to convert msgId to string
const sharedMsgIdBuf = Buffer.alloc(20);

/**
 * The function used to generate a gossipsub message id
 * We use the first 8 bytes of SHA256(data) for content addressing
 */
export function fastMsgIdFn(rpcMsg: RPC.Message): string {
  if (rpcMsg.data) {
    return xxhash.h64Raw(rpcMsg.data, h64Seed).toString(16);
  }
  return "0000000000000000";
}

export function msgIdToStrFn(msgId: Uint8Array): string {
  // this is the same logic to `toHex(msgId)` with better performance
  sharedMsgIdBuf.set(msgId);
  return `0x${sharedMsgIdBuf.toString("hex")}`;
}

/**
 * Only valid msgId. Messages that fail to snappy_decompress() are not tracked
 */
export function msgIdFn(gossipTopicCache: GossipTopicCache, msg: Message): Uint8Array {
  const topic = gossipTopicCache.getTopic(msg.topic);

  let vec: Uint8Array[];

  if (topic.boundary.fork === ForkName.phase0) {
    // message id for phase0.
    // ```
    // SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + snappy_decompress(message.data))[:20]
    // ```
    vec = [MESSAGE_DOMAIN_VALID_SNAPPY, msg.data];
  } else {
    // message id for altair and subsequent future forks.
    // ```
    // SHA256(
    //   MESSAGE_DOMAIN_VALID_SNAPPY +
    //   uint_to_bytes(uint64(len(message.topic))) +
    //   message.topic +
    //   snappy_decompress(message.data)
    // )[:20]
    // ```
    // https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.7/specs/altair/p2p-interface.md#topics-and-messages
    vec = [MESSAGE_DOMAIN_VALID_SNAPPY, intToBytes(msg.topic.length, 8), Buffer.from(msg.topic), msg.data];
  }

  return digest(Buffer.concat(vec)).subarray(0, 20);
}

export class DataTransformSnappy implements DataTransform {
  allocByTopicType = new Map<GossipType, number>();

  constructor(
    private readonly gossipTopicCache: GossipTopicCache,
    private readonly maxSizePerMessage: number,
    private readonly config: BeaconConfig
  ) {}

  /**
   * Takes the data published by peers on a topic and transforms the data.
   * Should be the reverse of outboundTransform(). Example:
   * - `inboundTransform()`: decompress snappy payload
   * - `outboundTransform()`: compress snappy payload
   */
  inboundTransform(topicStr: string, data: Uint8Array): Uint8Array {
    const topic = this.gossipTopicCache.getTopic(topicStr);
    let buffer: Uint8Array | undefined = undefined;
    const inboundCache = globalInboundCache.get(topic.type);
    if (inboundCache) {
      const arraybuffer = inboundCache.pop();
      if (arraybuffer) {
        buffer = new Uint8Array(arraybuffer);
      } else {
        // for some first few messages when pool is empty, allocate new buffer
        // they will be added back to pool after emit to the main thread
        this.allocByTopicType.set(topic.type, (this.allocByTopicType.get(topic.type) ?? 0) + 1);
        switch (topic.type) {
          // TODO: reevaluate after each hard fork
          // deneb + electra
          case GossipType.blob_sidecar: {
            buffer = new Uint8Array(ssz.deneb.BlobSidecar.fixedSize as number);
            break;
          }
          // fulu
          case GossipType.data_column_sidecar: {
            const maxBlobs = this.config.getMaxBlobsPerBlock(topic.boundary.epoch);
            buffer = new Uint8Array(getMaxDataColumnSizeCarBytes(maxBlobs));
            break;
          }
          // all forks
          case GossipType.beacon_attestation:
            buffer = new Uint8Array(ssz.electra.SingleAttestation.fixedSize as number);
            break;
          case GossipType.beacon_aggregate_and_proof:
            buffer = new Uint8Array(ssz.electra.SignedAggregateAndProof.maxSize);
            break;
          case GossipType.sync_committee:
            buffer = new Uint8Array(ssz.altair.SyncCommitteeMessage.fixedSize as number);
            break;
          case GossipType.sync_committee_contribution_and_proof:
            buffer = new Uint8Array(ssz.altair.SignedContributionAndProof.maxSize);
            break;
          case GossipType.beacon_block:
          // should not put the max size of beacon block here
          // instead of that, we allocate the exact size initially and reuse it
          // if a bigger block comes, we fall back to allocate new buffer without reusing
          // and use it for future blocks
          default:
            buffer = undefined;
            break;
        }
      }
    }
    const uncompressedData = this.uncompress(topic.type, data, buffer);
    const sszType = getGossipSSZType(topic);

    // check uncompressed data length before we extract beacon block root, slot or
    // attestation data at later steps
    const uncompressedDataLength = uncompressedData.length;
    if (uncompressedDataLength < sszType.minSize) {
      throw Error(`ssz_snappy decoded data length ${uncompressedDataLength} < ${sszType.minSize}`);
    }
    if (uncompressedDataLength > sszType.maxSize) {
      throw Error(`ssz_snappy decoded data length ${uncompressedDataLength} > ${sszType.maxSize}`);
    }

    return uncompressedData;
  }

  /**
   * Takes the data to be published (a topic and associated data) transforms the data. The
   * transformed data will then be used to create a `RawGossipsubMessage` to be sent to peers.
   */
  outboundTransform(_topicStr: string, data: Uint8Array): Uint8Array {
    if (data.length > this.maxSizePerMessage) {
      throw Error(`ssz_snappy encoded data length ${data.length} > ${this.maxSizePerMessage}`);
    }
    // No need to parse topic, everything is snappy compressed
    return compress(data);
  }

  private uncompress(type: GossipType, data: Uint8Array, buffer: Uint8Array | undefined): Uint8Array {
    try {
      return uncompress(data, this.maxSizePerMessage, buffer);
    } catch (e) {
      if (buffer === undefined || !(e instanceof SnappyError)) {
        throw e;
      }
      if ((e as SnappyError<{code: SnappyErrorCode}>).type.code === SnappyErrorCode.UNCOMPRESS_BUFFER_TOO_SMALL) {
        this.allocByTopicType.set(type, (this.allocByTopicType.get(type) ?? 0) + 1);
        return uncompress(data, this.maxSizePerMessage, undefined);
      }
      throw e;
    }
  }
}

export class InboundTransformBufferPool {
  private buffers: LinkedList<ArrayBuffer> = new LinkedList<ArrayBuffer>();
  constructor(private readonly maxLength: number) {}

  add(buffer: ArrayBuffer): void {
    // prefer new buffer because it may have bigger length than the old one
    // for example when the max blobs per block increases
    this.buffers.push(buffer);
    while (this.buffers.length > this.maxLength) {
      this.buffers.shift();
    }
  }

  pop(): ArrayBuffer | null {
    return this.buffers.pop();
  }

  size(): number {
    return this.buffers.length;
  }
}

// pool of buffers for each topic to uncompress incoming messages into
// TODO: reevaluate these numbers
export const globalInboundCache = new Map<GossipType, InboundTransformBufferPool>();
// electra
globalInboundCache.set(GossipType.blob_sidecar, new InboundTransformBufferPool(9));
// fulu
globalInboundCache.set(GossipType.data_column_sidecar, new InboundTransformBufferPool(NUMBER_OF_COLUMNS));
globalInboundCache.set(GossipType.beacon_attestation, new InboundTransformBufferPool(1_000));
globalInboundCache.set(GossipType.beacon_aggregate_and_proof, new InboundTransformBufferPool(100));
globalInboundCache.set(GossipType.sync_committee, new InboundTransformBufferPool(100));
globalInboundCache.set(GossipType.sync_committee_contribution_and_proof, new InboundTransformBufferPool(100));
globalInboundCache.set(GossipType.beacon_block, new InboundTransformBufferPool(1));
// TODO: other topics
