import {digest} from "@chainsafe/as-sha256";
import {compress, uncompress} from "snappyjs";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {ForkName} from "@chainsafe/lodestar-params";
import {MESSAGE_DOMAIN_VALID_SNAPPY} from "./constants.js";
import {GossipTopicCache} from "./topic.js";
import {RPC} from "libp2p-gossipsub/src/message/rpc";
import {GossipsubMessage} from "libp2p-gossipsub/src/types";

/**
 * The function used to generate a gossipsub message id
 * We use the first 8 bytes of SHA256(data) for content addressing
 */
export function fastMsgIdFn(rpcMsg: RPC.IMessage): string {
  if (rpcMsg.data) {
    return Buffer.from(digest(rpcMsg.data)).slice(0, 8).toString("hex");
  } else {
    return "0000000000000000";
  }
}

/**
 * Only valid msgId. Messages that fail to snappy_decompress() are not tracked
 */
export function msgIdFn(gossipTopicCache: GossipTopicCache, msg: GossipsubMessage): Uint8Array {
  const topic = gossipTopicCache.getTopic(msg.topic);

  let vec: Uint8Array[];

  switch (topic.fork) {
    // message id for phase0.
    // ```
    // SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + snappy_decompress(message.data))[:20]
    // ```
    case ForkName.phase0:
      vec = [MESSAGE_DOMAIN_VALID_SNAPPY, msg.data];
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
      vec = [MESSAGE_DOMAIN_VALID_SNAPPY, intToBytes(msg.topic.length, 8), Buffer.from(msg.topic), msg.data];
      break;
    }
  }

  return digest(Buffer.concat(vec)).slice(0, 20);
}

export class DataTransformSnappy {
  constructor(private readonly gossipTopicCache: GossipTopicCache) {}

  /**
   * Takes the data published by peers on a topic and transforms the data.
   * Should be the reverse of outboundTransform(). Example:
   * - `inboundTransform()`: decompress snappy payload
   * - `outboundTransform()`: compress snappy payload
   */
  inboundTransform(topicStr: string, data: Uint8Array): Uint8Array {
    // No need to parse topic, everything is snappy compressed
    return uncompress(data);
  }
  /**
   * Takes the data to be published (a topic and associated data) transforms the data. The
   * transformed data will then be used to create a `RawGossipsubMessage` to be sent to peers.
   */
  outboundTransform(topicStr: string, data: Uint8Array): Uint8Array {
    // No need to parse topic, everything is snappy compressed
    return compress(data);
  }
}
