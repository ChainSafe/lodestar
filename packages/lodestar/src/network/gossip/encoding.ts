import {compress, uncompress} from "snappyjs";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";
import {
  DEFAULT_ENCODING,
  GOSSIP_MSGID_LENGTH,
  MESSAGE_DOMAIN_INVALID_SNAPPY,
  MESSAGE_DOMAIN_VALID_SNAPPY,
} from "./constants";
import {GossipEncoding, GossipTopic} from "./interface";
import {ForkName} from "@chainsafe/lodestar-params";

export interface IUncompressCache {
  uncompress(input: Uint8Array): Uint8Array;
}

export class UncompressCache implements IUncompressCache {
  private cache = new WeakMap<Uint8Array, Uint8Array>();

  uncompress(input: Uint8Array): Uint8Array {
    let uncompressed = this.cache.get(input);
    if (!uncompressed) {
      uncompressed = uncompress(input);
      this.cache.set(input, uncompressed);
    }
    return uncompressed;
  }
}

/**
 * Decode message using `IUncompressCache`. Message will have been uncompressed before to compute the msgId.
 * We must re-use that result to prevent uncompressing the object again here.
 */
export function decodeMessageData(
  encoding: GossipEncoding,
  msgData: Uint8Array,
  uncompressCache: IUncompressCache
): Uint8Array {
  switch (encoding) {
    case GossipEncoding.ssz_snappy:
      return uncompressCache.uncompress(msgData);

    default:
      throw new Error(`Unsupported encoding ${encoding}`);
  }
}

export function encodeMessageData(encoding: GossipEncoding, msgData: Uint8Array): Uint8Array {
  switch (encoding) {
    case GossipEncoding.ssz_snappy:
      return compress(msgData);

    default:
      throw new Error(`Unsupported encoding ${encoding}`);
  }
}

/**
 * Function to compute message id for all forks.
 */
export function computeMsgId(
  topic: GossipTopic,
  topicStr: string,
  msgData: Uint8Array,
  uncompressCache: IUncompressCache
): Uint8Array {
  switch (topic.fork) {
    case ForkName.phase0:
      return computeMsgIdPhase0(topic, msgData, uncompressCache);
    case ForkName.altair:
    case ForkName.bellatrix:
      return computeMsgIdAltair(topic, topicStr, msgData, uncompressCache);
  }
}

/**
 * Function to compute message id for phase0.
 * ```
 * SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + snappy_decompress(message.data))[:20]
 * ```
 */
export function computeMsgIdPhase0(
  topic: GossipTopic,
  msgData: Uint8Array,
  uncompressCache: IUncompressCache
): Uint8Array {
  switch (topic.encoding ?? DEFAULT_ENCODING) {
    case GossipEncoding.ssz_snappy:
      try {
        const uncompressed = uncompressCache.uncompress(msgData);
        return hashGossipMsgData(MESSAGE_DOMAIN_VALID_SNAPPY, uncompressed);
      } catch (e) {
        return hashGossipMsgData(MESSAGE_DOMAIN_INVALID_SNAPPY, msgData);
      }
  }
}

/**
 * Function to compute message id for altair.
 *
 * ```
 * SHA256(
 *   MESSAGE_DOMAIN_VALID_SNAPPY +
 *   uint_to_bytes(uint64(len(message.topic))) +
 *   message.topic +
 *   snappy_decompress(message.data)
 * )[:20]
 * ```
 * https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.7/specs/altair/p2p-interface.md#topics-and-messages
 */
export function computeMsgIdAltair(
  topic: GossipTopic,
  topicStr: string,
  msgData: Uint8Array,
  uncompressCache: IUncompressCache
): Uint8Array {
  switch (topic.encoding ?? DEFAULT_ENCODING) {
    case GossipEncoding.ssz_snappy:
      try {
        const uncompressed = uncompressCache.uncompress(msgData);
        return hashGossipMsgData(
          MESSAGE_DOMAIN_VALID_SNAPPY,
          intToBytes(topicStr.length, 8),
          Buffer.from(topicStr),
          uncompressed
        );
      } catch (e) {
        return hashGossipMsgData(
          MESSAGE_DOMAIN_INVALID_SNAPPY,
          intToBytes(topicStr.length, 8),
          Buffer.from(topicStr),
          msgData
        );
      }
  }
}

function hashGossipMsgData(...dataArrToHash: Uint8Array[]): Uint8Array {
  return hash(Buffer.concat(dataArrToHash)).slice(0, GOSSIP_MSGID_LENGTH);
}
