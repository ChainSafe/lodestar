/**
 * @module network/gossip
 */

import {Gossip} from "../gossip";
import {IGossipMessage} from "../interface";
import {deserializeGossipMessage, getGossipTopic} from "../utils";
import {VoluntaryExit} from "@chainsafe/eth2.0-types";
import {GossipEvent} from "../constants";
import {serialize} from "@chainsafe/ssz";
//@ts-ignore
import promisify from "promisify-es6";

export function handleIncomingVoluntaryExit(this: Gossip, msg: IGossipMessage): void {
  try {
    const voluntaryExit = deserializeGossipMessage<VoluntaryExit>(msg, this.config.types.VoluntaryExit);
    this.logger.verbose(
      `Received voluntary exit for validator #${voluntaryExit.validatorIndex}`
    );
    this.emit(GossipEvent.VOLUNTARY_EXIT, voluntaryExit);
  } catch (e) {
    this.logger.warn("Incoming voluntary exit error", e);
  }
}

export async function publishVoluntaryExit(this: Gossip, voluntaryExit: VoluntaryExit): Promise<void> {
  await promisify(this.pubsub.publish.bind(this.pubsub))(
    getGossipTopic(GossipEvent.VOLUNTARY_EXIT), serialize(voluntaryExit, this.config.types.VoluntaryExit));
  this.logger.verbose(
    `Publishing voluntary exit for validator #${voluntaryExit.validatorIndex}`
  );
}