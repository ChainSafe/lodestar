/**
 * @module network/gossip
 */

import {InMessage} from "libp2p-interfaces/src/pubsub";
import {ForkName} from "@chainsafe/lodestar-params";
import {IGossipMessage} from "./interface";
import {computeMsgIdAltair, computeMsgIdPhase0} from "./encoding";
import {GOSSIP_MAX_SIZE} from "../../constants";
import {IForkDigestContext} from "../../util/forkDigestContext";
import {getForkFromGossipTopic} from "./topic";

/**
 * Basic sanity check on gossip message
 */
export function messageIsValid(message: InMessage): boolean | undefined {
  return message.topicIDs && message.topicIDs.length === 1 && message.data && message.data.length <= GOSSIP_MAX_SIZE;
}

export function msgIdToString(msgId: Uint8Array): string {
  return Buffer.from(msgId).toString("base64");
}

export function getMsgId(msg: IGossipMessage, forkDigestContext: IForkDigestContext): Uint8Array {
  const topic = msg.topicIDs[0];
  const fork = getForkFromGossipTopic(forkDigestContext, topic);
  if (!msg.msgId) {
    const {msgId, uncompressed} =
      fork === ForkName.phase0 ? computeMsgIdPhase0(topic, msg.data) : computeMsgIdAltair(topic, msg.data);
    msg.msgId = msgId;
    msg.uncompressed = uncompressed;
  }
  return msg.msgId;
}
