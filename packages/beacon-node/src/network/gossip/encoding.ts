import xxhashFactory from "xxhash-wasm";
import {Message} from "@libp2p/interface";
import {digest} from "@chainsafe/as-sha256";
import {RPC} from "@chainsafe/libp2p-gossipsub/message";
import {DataTransform} from "@chainsafe/libp2p-gossipsub/types";
import snappyWasm from "@chainsafe/snappy-wasm";
import {intToBytes} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants.js";
import {getGossipSSZType, GossipTopicCache} from "./topic.js";

// Load WASM
const xxhash = await xxhashFactory();

// Use salt to prevent msgId from being mined for collisions
const h64Seed = BigInt(Math.floor(Math.random() * 1e9));

// create singleton snappy encoder + decoder
const encoder = new snappyWasm.Encoder();
const decoder = new snappyWasm.Decoder();

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

  return digest(Buffer.concat(vec)).subarray(0, 20);
}

export class DataTransformSnappy implements DataTransform {
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
    // check uncompressed data length before we actually decompress
    const uncompressedDataLength = snappyWasm.decompress_len(data);
    if (uncompressedDataLength > this.maxSizePerMessage) {
      throw Error(`ssz_snappy decoded data length ${uncompressedDataLength} > ${this.maxSizePerMessage}`);
    }

    const topic = this.gossipTopicCache.getTopic(topicStr);
    const sszType = getGossipSSZType(topic);

    if (uncompressedDataLength < sszType.minSize) {
      throw Error(`ssz_snappy decoded data length ${uncompressedDataLength} < ${sszType.minSize}`);
    }
    if (uncompressedDataLength > sszType.maxSize) {
      throw Error(`ssz_snappy decoded data length ${uncompressedDataLength} > ${sszType.maxSize}`);
    }

    // Only after saniy length checks, we can decompress the data
    const uncompressedData = Buffer.allocUnsafe(uncompressedDataLength);
    decoder.decompress_into(data, uncompressedData);
    return uncompressedData;
  }

  /**
   * Takes the data to be published (a topic and associated data) transforms the data. The
   * transformed data will then be used to create a `RawGossipsubMessage` to be sent to peers.
   */
  // No need to parse topic, everything is snappy compressed
  outboundTransform(_topicStr: string, data: Uint8Array): Uint8Array {
    if (data.length > this.maxSizePerMessage) {
      throw Error(`ssz_snappy encoded data length ${data.length} > ${this.maxSizePerMessage}`);
    }

    const compressedData = Buffer.allocUnsafe(snappyWasm.max_compress_len(data.length));
    const compressedLen = encoder.compress_into(data, compressedData);
    return compressedData.subarray(0, compressedLen);
  }
}
