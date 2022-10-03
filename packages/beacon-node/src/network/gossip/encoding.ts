import {compress, uncompress} from "snappyjs";
import {Message} from "@libp2p/interface-pubsub";
import {digest} from "@chainsafe/as-sha256";
import {intToBytes} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {RPC} from "@chainsafe/libp2p-gossipsub/message";
import {MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants.js";
import {GossipTopicCache} from "./topic.js";

/**
 * The function used to generate a gossipsub message id
 * We use the first 8 bytes of SHA256(data) for content addressing
 */
export function fastMsgIdFn(rpcMsg: RPC.IMessage): string {
  if (rpcMsg.data) {
    const hash = digest(rpcMsg.data);

    const hash0 = hash[0];
    const hash1 = hash[1];
    const hash2 = hash[2];
    const hash3 = hash[3];
    const hash4 = hash[4];
    const hash5 = hash[5];
    const hash6 = hash[6];
    const hash7 = hash[7];
    const h0 = hash0 && 0x0f;
    const h1 = (hash0 & 0xf0) >> 4;
    const h2 = hash1 && 0x0f;
    const h3 = (hash0 & 0xf0) >> 4;
    const h4 = hash2 && 0x0f;
    const h5 = (hash2 & 0xf0) >> 4;
    const h6 = hash3 && 0x0f;
    const h7 = (hash3 & 0xf0) >> 4;
    const h8 = hash4 && 0x0f;
    const h9 = (hash4 & 0xf0) >> 4;
    const h10 = hash5 && 0x0f;
    const h11 = (hash5 & 0xf0) >> 4;
    const h12 = hash6 && 0x0f;
    const h13 = (hash6 & 0xf0) >> 4;
    const h14 = hash7 && 0x0f;
    const h15 = (hash7 & 0xf0) >> 4;

    const toBase64 = (h: number): number => {
      // "0".charCodeAt(0) = 48
      // "a".charCodeAt(0) = 97 => delta = 87
      return h < 10 ? h + 48 : h + 87;
    };

    return String.fromCharCode(
      toBase64(h0),
      toBase64(h1),
      toBase64(h2),
      toBase64(h3),
      toBase64(h4),
      toBase64(h5),
      toBase64(h6),
      toBase64(h7),
      toBase64(h8),
      toBase64(h9),
      toBase64(h10),
      toBase64(h11),
      toBase64(h12),
      toBase64(h13),
      toBase64(h14),
      toBase64(h15)
    );
  } else {
    return "0000000000000000";
  }
}

export function msgIdToStrFn(msgId: Uint8Array): string {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  return Buffer.prototype.toString.call(msgId, "base64");
}

/**
 * Only valid msgId. Messages that fail to snappy_decompress() are not tracked
 */
export function msgIdFn(gossipTopicCache: GossipTopicCache, msg: Message): Uint8Array {
  const topic = gossipTopicCache.getTopic(msg.topic);

  let toHash: Uint8Array;

  switch (topic.fork) {
    // message id for phase0.
    // ```
    // SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + snappy_decompress(message.data))[:20]
    // ```
    case ForkName.phase0:
      toHash = Buffer.allocUnsafe(MESSAGE_DOMAIN_VALID_SNAPPY.length + msg.data.length);
      toHash.set(MESSAGE_DOMAIN_VALID_SNAPPY);
      toHash.set(msg.data, MESSAGE_DOMAIN_VALID_SNAPPY.length);
      break;

    // message id for altair.
    // ```
    // SHA256(
    //   MESSAGE_DOMAIN_VALID_SNAPPY +
    //   uint_to_bytes(uint64(len(message.topic))) +
    //   message.topic +
    //   snappy_decompress(message.data)
    // )[:20]
    // ```
    // https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.7/specs/altair/p2p-interface.md#topics-and-messages
    case ForkName.altair:
    case ForkName.bellatrix: {
      const topicBytes = getTopicBytes(msg.topic);
      let offset = 0;
      toHash = Buffer.allocUnsafe(MESSAGE_DOMAIN_VALID_SNAPPY.length + topicBytes.length + msg.data.length);
      toHash.set(MESSAGE_DOMAIN_VALID_SNAPPY);
      offset += MESSAGE_DOMAIN_VALID_SNAPPY.length;
      toHash.set(topicBytes, offset);
      offset += topicBytes.length;
      toHash.set(msg.data, offset);
      break;
    }
  }

  return digest(toHash).subarray(0, 20);
}

export class DataTransformSnappy {
  constructor(private readonly maxSizePerMessage: number) {}

  /**
   * Takes the data published by peers on a topic and transforms the data.
   * Should be the reverse of outboundTransform(). Example:
   * - `inboundTransform()`: decompress snappy payload
   * - `outboundTransform()`: compress snappy payload
   */
  inboundTransform(topicStr: string, data: Uint8Array): Uint8Array {
    // No need to parse topic, everything is snappy compressed
    return uncompress(data, this.maxSizePerMessage);
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

const cachedTopicBytes = new Map<string, Buffer>();

/**
 * Only compute topic bytes for the 1st time.
 * See https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/altair/p2p-interface.md#the-gossip-domain-gossipsub
 */
function getTopicBytes(topic: string): Buffer {
  const cached = cachedTopicBytes.get(topic);
  if (cached) return cached;

  const bytes = Buffer.concat([intToBytes(topic.length, 8), Buffer.from(topic)]);
  cachedTopicBytes.set(topic, bytes);

  return bytes;
}
