/**
 * @module network/gossip
 */

import {InMessage} from "libp2p-interfaces/src/pubsub";
import {IGossipMessage} from "./interface";
import {computeMsgId} from "./encoding";
import {GOSSIP_MAX_SIZE} from "../../constants";

/**
 * Basic sanity check on gossip message
 */
export function messageIsValid(message: InMessage): boolean | undefined {
  return message.topicIDs && message.topicIDs.length === 1 && message.data && message.data.length <= GOSSIP_MAX_SIZE;
}

export function msgIdToString(msgId: Uint8Array): string {
  return Buffer.from(msgId).toString("base64");
}

export function getMsgId(msg: IGossipMessage): Uint8Array {
  if (!msg.msgId) {
    const {msgId, uncompressed} = computeMsgId(msg.topicIDs[0], msg.data);
    msg.msgId = msgId;
    msg.uncompressed = uncompressed;
  }
  return msg.msgId;
}
