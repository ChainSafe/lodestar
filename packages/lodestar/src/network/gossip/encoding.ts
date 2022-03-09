import {compress, uncompress} from "snappyjs";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";
import {ForkName} from "@chainsafe/lodestar-params";
import {
  DEFAULT_ENCODING,
  GOSSIP_MSGID_LENGTH,
  MESSAGE_DOMAIN_INVALID_SNAPPY,
  MESSAGE_DOMAIN_VALID_SNAPPY,
} from "./constants";
import {Eth2InMessage, GossipEncoding, GossipTopic} from "./interface";

/**
 * Uncompressed data is used to
 * - compute message id
 * - if message is not seen then we use it to deserialize to gossip object
 *
 * We cache uncompressed data in InMessage to prevent uncompressing multiple times.
 */
export function getUncompressedData(msg: Eth2InMessage): Uint8Array {
  if (!msg.uncompressedData) {
    msg.uncompressedData = uncompress(msg.data);
  }

  return msg.uncompressedData;
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
export function computeMsgId(topic: GossipTopic, topicStr: string, msg: Eth2InMessage): Uint8Array {
  switch (topic.fork) {
    case ForkName.phase0:
      return computeMsgIdPhase0(topic, msg);
    case ForkName.altair:
    case ForkName.bellatrix:
      return computeMsgIdAltair(topic, topicStr, msg);
  }
}

/**
 * Function to compute message id for phase0.
 * ```
 * SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + snappy_decompress(message.data))[:20]
 * ```
 */
export function computeMsgIdPhase0(topic: GossipTopic, msg: Eth2InMessage): Uint8Array {
  switch (topic.encoding ?? DEFAULT_ENCODING) {
    case GossipEncoding.ssz_snappy:
      try {
        const uncompressed = getUncompressedData(msg);
        return hashGossipMsgData(MESSAGE_DOMAIN_VALID_SNAPPY, uncompressed);
      } catch (e) {
        return hashGossipMsgData(MESSAGE_DOMAIN_INVALID_SNAPPY, msg.data);
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
export function computeMsgIdAltair(topic: GossipTopic, topicStr: string, msg: Eth2InMessage): Uint8Array {
  switch (topic.encoding ?? DEFAULT_ENCODING) {
    case GossipEncoding.ssz_snappy:
      try {
        const uncompressed = getUncompressedData(msg);
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
          msg.data
        );
      }
  }
}

function hashGossipMsgData(...dataArrToHash: Uint8Array[]): Uint8Array {
  return hash(Buffer.concat(dataArrToHash)).slice(0, GOSSIP_MSGID_LENGTH);
}
