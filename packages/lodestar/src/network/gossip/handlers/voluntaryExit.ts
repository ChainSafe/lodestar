/**
 * @module network/gossip
 */

import {Gossip, GossipHandlerFn} from "../gossip";
import {IGossipMessage, IGossipMessageValidator} from "../interface";
import {deserializeGossipMessage, getGossipTopic} from "../utils";
import {SignedVoluntaryExit} from "@chainsafe/eth2.0-types";
import {GossipEvent} from "../constants";
import {serialize} from "@chainsafe/ssz";
import {promisify} from "es6-promisify";

export function getIncomingVoluntaryExitHandler(validator: IGossipMessageValidator): GossipHandlerFn {
  return async function handleIncomingVoluntaryExit(this: Gossip, msg: IGossipMessage): Promise<void> {
    try {
      const voluntaryExit = deserializeGossipMessage<SignedVoluntaryExit>(msg, this.config.types.SignedVoluntaryExit);
      this.logger.verbose(
        `Received voluntary exit for validator #${voluntaryExit.message.validatorIndex}`
      );
      if (await validator.isValidIncomingVoluntaryExit(voluntaryExit)) {
        this.emit(GossipEvent.VOLUNTARY_EXIT, voluntaryExit);
      }
    } catch (e) {
      this.logger.warn("Incoming voluntary exit error", e);
    }
  };
}

export async function publishVoluntaryExit(this: Gossip, voluntaryExit: SignedVoluntaryExit): Promise<void> {
  await promisify<void, string, Buffer>(this.pubsub.publish.bind(this.pubsub))(
    getGossipTopic(GossipEvent.VOLUNTARY_EXIT), serialize(this.config.types.SignedVoluntaryExit, voluntaryExit));
  this.logger.verbose(
    `Publishing voluntary exit for validator #${voluntaryExit.message.validatorIndex}`
  );
}
