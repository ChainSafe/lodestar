import {compress, uncompress} from "snappyjs";
import {hash} from "@chainsafe/ssz";
import {GOSSIP_MSGID_LENGTH, MESSAGE_DOMAIN_INVALID_SNAPPY, MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants";

export enum GossipEncoding {
  SSZ = "ssz",
  SSZ_SNAPPY = "ssz_snappy",
}

export function getTopicEncoding(topic: string): GossipEncoding {
  if (topic.endsWith(GossipEncoding.SSZ)) {
    return GossipEncoding.SSZ;
  }
  if (topic.endsWith(GossipEncoding.SSZ_SNAPPY)) {
    return GossipEncoding.SSZ_SNAPPY;
  }
  throw `Unknown gossip encoding "${topic.split("/").pop()}"`;
}

export function decodeMessageData(topic: string, data: Uint8Array): Uint8Array {
  const encoding = getTopicEncoding(topic);

  switch (encoding) {
    case GossipEncoding.SSZ_SNAPPY:
      return uncompress(data);
    default:
      return data;
  }
}

export function encodeMessageData(topic: string, data: Uint8Array): Uint8Array {
  const encoding = getTopicEncoding(topic);

  switch (encoding) {
    case GossipEncoding.SSZ_SNAPPY:
      return compress(data);
    default:
      return data;
  }
}

export function computeMsgId(topic: string, data: Uint8Array): Uint8Array {
  const encoding = getTopicEncoding(topic);

  let dataToHash: Uint8Array;
  switch (encoding) {
    case GossipEncoding.SSZ_SNAPPY:
      try {
        const uncompressed = uncompress(data);
        dataToHash = Buffer.concat([MESSAGE_DOMAIN_VALID_SNAPPY, uncompressed]);
      } catch (e) {
        dataToHash = Buffer.concat([MESSAGE_DOMAIN_INVALID_SNAPPY, data]);
      }
      break;
    default:
      dataToHash = data;
  }

  return hash(dataToHash).slice(0, GOSSIP_MSGID_LENGTH);
}
