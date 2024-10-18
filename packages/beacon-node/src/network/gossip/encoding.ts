import {compress, uncompress} from "snappyjs";
import xxhashFactory from "xxhash-wasm";
import {Message} from "@libp2p/interface";
import {digest} from "@chainsafe/as-sha256";
import {RPC} from "@chainsafe/libp2p-gossipsub/message";
import {DataTransform} from "@chainsafe/libp2p-gossipsub/types";
import {intToBytes} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants.js";
import {getGossipSSZType, GossipTopicCache} from "./topic.js";

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

// Shared buffer to store the concatenated data for hashing
// increase length if needed
var sharedDigestBuf = new Uint8Array(0);

/**
 * Only valid msgId. Messages that fail to snappy_decompress() are not tracked
 */
export function msgIdFn(gossipTopicCache: GossipTopicCache, msg: Message): Uint8Array {
  const topic = gossipTopicCache.getTopic(msg.topic);

  let digestLength = 0;
  if (topic.fork === ForkName.phase0) {
    // message id for phase0.
    // ```
    // SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + snappy_decompress(message.data))[:20]
    // ```
    // vec = [MESSAGE_DOMAIN_VALID_SNAPPY, msg.data];
    digestLength = MESSAGE_DOMAIN_VALID_SNAPPY.length + msg.data.length;
    if (sharedDigestBuf.length < digestLength) {
      sharedDigestBuf = new Uint8Array(digestLength);
    }
    sharedDigestBuf.set(MESSAGE_DOMAIN_VALID_SNAPPY, 0);
    sharedDigestBuf.set(msg.data, MESSAGE_DOMAIN_VALID_SNAPPY.length);
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

    const topicBuf = Buffer.from(msg.topic);
    digestLength = MESSAGE_DOMAIN_VALID_SNAPPY.length + 8 + topicBuf.length + msg.data.length;
    if (sharedDigestBuf.length < digestLength) {
      sharedDigestBuf = new Uint8Array(digestLength);
    }
    let offset = 0;
    sharedDigestBuf.set(MESSAGE_DOMAIN_VALID_SNAPPY, offset);
    offset += MESSAGE_DOMAIN_VALID_SNAPPY.length;
    sharedDigestBuf.set(intToBytes(msg.topic.length, 8), offset);
    offset += 8;
    sharedDigestBuf.set(topicBuf, offset);
    offset += topicBuf.length;
    sharedDigestBuf.set(msg.data, offset);
  }

  return digest(sharedDigestBuf.subarray(0, digestLength)).subarray(0, 20);
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
  outboundTransform(_topicStr: string, data: Uint8Array): Uint8Array {
    if (data.length > this.maxSizePerMessage) {
      throw Error(`ssz_snappy encoded data length ${data.length} > ${this.maxSizePerMessage}`);
    }
    // No need to parse topic, everything is snappy compressed
    return compress(data);
  }
}
