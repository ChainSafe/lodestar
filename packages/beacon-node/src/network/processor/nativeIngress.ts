import {gossipQueues} from "@lodestar/native/gossip-queues";
import {ForkSeq} from "@lodestar/params";
import {IClock} from "../../util/clock.js";
import {PendingGossipsubMessage} from "./types.js";

export type GossipReceipt = Pick<
  PendingGossipsubMessage,
  "msgId" | "propagationSource" | "clientAgent" | "clientVersion" | "seenTimestampSec"
> & {topic: string};

export function offerGossip(
  id: number,
  clock: Pick<IClock, "currentSlot" | "currentSlotWithGossipDisparity">,
  message: PendingGossipsubMessage
): boolean {
  const {msg, topic, msgId, propagationSource, clientAgent, clientVersion, seenTimestampSec} = message;
  const receipt: GossipReceipt = {
    topic: msg.topic,
    msgId,
    propagationSource,
    clientAgent,
    clientVersion: clientVersion.slice(0, 96),
    seenTimestampSec,
  };
  return gossipQueues.offer(
    id,
    topic.type,
    ForkSeq[topic.boundary.fork],
    Number.parseInt(msg.topic.slice(6, 14), 16),
    propagationSource,
    JSON.stringify(receipt),
    msg.data,
    Math.max(0, clock.currentSlot),
    Math.max(0, clock.currentSlotWithGossipDisparity)
  );
}
