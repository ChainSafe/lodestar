import {compress, uncompress} from "snappyjs";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";
import {GOSSIP_MSGID_LENGTH, MESSAGE_DOMAIN_INVALID_SNAPPY, MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants";
import {GossipEncoding, IGossipMessage} from "./interface";

export function getTopicEncoding(topic: string): GossipEncoding {
  if (topic.endsWith(GossipEncoding.ssz)) {
    return GossipEncoding.ssz;
  }

  if (topic.endsWith(GossipEncoding.ssz_snappy)) {
    return GossipEncoding.ssz_snappy;
  }

  throw `Unknown gossip encoding "${topic.split("/").pop()}"`;
}

export function decodeMessageData(encoding: GossipEncoding, data: Uint8Array): Uint8Array {
  switch (encoding) {
    case GossipEncoding.ssz_snappy:
      return uncompress(data);

    case GossipEncoding.ssz:
      return data;

    default:
      throw new Error(`Unsupported encoding ${encoding}`);
  }
}

export function encodeMessageData(encoding: GossipEncoding, data: Uint8Array): Uint8Array {
  switch (encoding) {
    case GossipEncoding.ssz_snappy:
      return compress(data);

    case GossipEncoding.ssz:
      return data;

    default:
      throw new Error(`Unsupported encoding ${encoding}`);
  }
}

export function getMessageDecoder(encoding: GossipEncoding): (message: IGossipMessage) => Uint8Array {
  switch (encoding) {
    case GossipEncoding.ssz_snappy:
      return (message) => {
        if (message.uncompressed) {
          return message.uncompressed;
        } else {
          return uncompress(message.data);
        }
      };

    case GossipEncoding.ssz:
      return (message) => message.data;

    default:
      throw new Error(`unsupported encoding ${encoding}`);
  }
}

/**
 * Function to compute message id for phase0.
 * Computing the message id requires uncompressing data, if applicable
 * Return both the computed message id and uncompressed data
 */
export function computeMsgIdPhase0(topic: string, data: Uint8Array): {msgId: Uint8Array; uncompressed?: Uint8Array} {
  const encoding = getTopicEncoding(topic);

  let dataToHash: Uint8Array;
  let uncompressed: Uint8Array | undefined;
  switch (encoding) {
    case GossipEncoding.ssz_snappy:
      try {
        uncompressed = uncompress(data);
        dataToHash = Buffer.concat([MESSAGE_DOMAIN_VALID_SNAPPY, uncompressed]);
      } catch (e) {
        dataToHash = Buffer.concat([MESSAGE_DOMAIN_INVALID_SNAPPY, data]);
      }
      break;

    default:
      uncompressed = data;
      dataToHash = data;
      break;
  }

  return {
    msgId: hash(dataToHash).slice(0, GOSSIP_MSGID_LENGTH),
    uncompressed,
  };
}

/**
 * Function to compute message id for altair.
 * https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.7/specs/altair/p2p-interface.md#topics-and-messages
 * Computing the message id requires uncompressing data, if applicable
 * Return both the computed message id and uncompressed data
 */
export function computeMsgIdAltair(topic: string, data: Uint8Array): {msgId: Uint8Array; uncompressed?: Uint8Array} {
  const encoding = getTopicEncoding(topic);

  let dataToHash: Uint8Array;
  let uncompressed: Uint8Array | undefined;
  switch (encoding) {
    case GossipEncoding.ssz_snappy:
      try {
        uncompressed = uncompress(data);
        dataToHash = Buffer.concat([
          MESSAGE_DOMAIN_VALID_SNAPPY,
          intToBytes(topic.length, 8),
          Buffer.from(topic),
          uncompressed,
        ]);
      } catch (e) {
        dataToHash = Buffer.concat([
          MESSAGE_DOMAIN_INVALID_SNAPPY,
          intToBytes(topic.length, 8),
          Buffer.from(topic),
          data,
        ]);
      }
      break;

    default:
      uncompressed = data;
      dataToHash = data;
      break;
  }

  return {
    msgId: hash(dataToHash).slice(0, GOSSIP_MSGID_LENGTH),
    uncompressed,
  };
}
