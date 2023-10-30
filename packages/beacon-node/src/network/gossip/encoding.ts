import {compress, uncompress} from "snappyjs";
import xxhashFactory from "xxhash-wasm";
import {Message} from "@libp2p/interface/pubsub";
import {digest} from "@chainsafe/as-sha256";
import {RPC} from "@chainsafe/libp2p-gossipsub/message";
import {intToBytes, toHex} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants.js";
import {getGossipSSZType, GossipTopicCache} from "./topic.js";

// Load WASM
const xxhash = await xxhashFactory();

// Use salt to prevent msgId from being mined for collisions
const h64Seed = BigInt(Math.floor(Math.random() * 1e9));

/**
 * The function used to generate a gossipsub message id
 * We use the first 8 bytes of SHA256(data) for content addressing
 */
export function fastMsgIdFn(rpcMsg: RPC.Message): string {
  if (rpcMsg.data) {
    return xxhash.h64Raw(rpcMsg.data, h64Seed).toString(16);
  } else {
    return "0000000000000000";
  }
}

export function msgIdToStrFn(msgId: Uint8Array): string {
  return toHex(msgId);
}

/**
 * Only valid msgId. Messages that fail to snappy_decompress() are not tracked
 */
export function msgIdFn(gossipTopicCache: GossipTopicCache, msg: Message): Uint8Array {
  const topic = gossipTopicCache.getTopic(msg.topic);

  let vec: Uint8Array[];

  if (topic.fork === ForkName.phase0) {
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

  return Buffer.from(digest(Buffer.concat(vec))).subarray(0, 20);
}

export class DataTransformSnappy {
  constructor(
    private readonly gossipTopicCache: GossipTopicCache,
    private readonly maxSizePerMessage: number
  ) {}

  /**
   * Takes the data published by peers on a topic and transforms the data.
   * Should be the reverse of outboundTransform(). Example:
   * - `inboundTransform()`: decompress snappy payload
   * - `outboundTransform()`: compress snappy payload
   */
  inboundTransform(topicStr: string, data: Uint8Array): Uint8Array {
    const uncompressedData = uncompress(data, this.maxSizePerMessage);

    // check uncompressed data length before we extract beacon block root, slot or
    // attestation data at later steps
    const uncompressedDataLength = uncompressedData.length;
    const topic = this.gossipTopicCache.getTopic(topicStr);
    const sszType = getGossipSSZType(topic);

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
  outboundTransform(topicStr: string, data: Uint8Array): Uint8Array {
    if (data.length > this.maxSizePerMessage) {
      throw Error(`ssz_snappy encoded data length ${length} > ${this.maxSizePerMessage}`);
    }
    // No need to parse topic, everything is snappy compressed
    return compress(data);
  }
}
