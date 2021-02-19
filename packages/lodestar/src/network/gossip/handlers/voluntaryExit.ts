/**
 * @module network/gossip
 */

import {Gossip} from "../gossip";
import {getGossipTopic} from "../utils";
import {phase0} from "@chainsafe/lodestar-types";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";

export async function handleIncomingVoluntaryExit(this: Gossip, obj: GossipObject): Promise<void> {
  try {
    const voluntaryExit = obj as phase0.SignedVoluntaryExit;
    this.logger.verbose("Received voluntary exit", {validator: voluntaryExit.message.validatorIndex});
    this.emit(GossipEvent.VOLUNTARY_EXIT, voluntaryExit);
  } catch (e) {
    this.logger.warn("Incoming voluntary exit error", e);
  }
}

export async function publishVoluntaryExit(this: Gossip, voluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
  const forkDigestValue = await this.getForkDigestByEpoch(voluntaryExit.message.epoch);
  const topic = getGossipTopic(GossipEvent.VOLUNTARY_EXIT, forkDigestValue);
  const voluntaryExitTopics = this.pubsub.getTopicPeerIds(topic);

  if (voluntaryExitTopics && voluntaryExitTopics.size > 0) {
    await this.pubsub.publish(
      getGossipTopic(GossipEvent.VOLUNTARY_EXIT, forkDigestValue),
      Buffer.from(this.config.types.phase0.SignedVoluntaryExit.serialize(voluntaryExit))
    );
    this.logger.verbose("Publishing voluntary exit", {validator: voluntaryExit.message.validatorIndex});
  } else {
    throw new Error("Not enough voluntary exit topic peers");
  }
}
