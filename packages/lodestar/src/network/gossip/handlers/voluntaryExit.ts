/**
 * @module network/gossip
 */

import {Gossip} from "../gossip";
import {getGossipTopic} from "../utils";
import {SignedVoluntaryExit} from "@chainsafe/eth2.0-types";
import {GossipEvent} from "../constants";
import {serialize} from "@chainsafe/ssz";
import {GossipObject} from "../interface";


export async function handleIncomingVoluntaryExit(this: Gossip, obj: GossipObject): Promise<void> {
  try {
    const voluntaryExit = obj as SignedVoluntaryExit;
    this.logger.verbose(
      `Received voluntary exit for validator #${voluntaryExit.message.validatorIndex}`
    );
    this.emit(GossipEvent.VOLUNTARY_EXIT, voluntaryExit);
  } catch (e) {
    this.logger.warn("Incoming voluntary exit error", e);
  }
}

export async function publishVoluntaryExit(this: Gossip, voluntaryExit: SignedVoluntaryExit): Promise<void> {
  await this.pubsub.publish(
    getGossipTopic(GossipEvent.VOLUNTARY_EXIT), serialize(this.config.types.SignedVoluntaryExit, voluntaryExit));
  this.logger.verbose(
    `Publishing voluntary exit for validator #${voluntaryExit.message.validatorIndex}`
  );
}
