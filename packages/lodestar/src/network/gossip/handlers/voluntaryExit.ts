/**
 * @module network/gossip
 */

import {Gossip, GossipHandlerFn} from "../gossip";
import {IGossipMessage, IGossipMessageValidator} from "../interface";
import {deserializeGossipMessage, getGossipTopic} from "../utils";
import {SignedVoluntaryExit} from "@chainsafe/eth2.0-types";
import {GossipEvent} from "../constants";

export function getIncomingVoluntaryExitHandler(validator: IGossipMessageValidator): GossipHandlerFn {
  return async function handleIncomingVoluntaryExit(this: Gossip, msg: IGossipMessage): Promise<void> {
    try {
      const voluntaryExit = deserializeGossipMessage<SignedVoluntaryExit>(this.config.types.SignedVoluntaryExit, msg);
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
  await this.pubsub.publish(
    getGossipTopic(GossipEvent.VOLUNTARY_EXIT),
    Buffer.from(this.config.types.SignedVoluntaryExit.serialize(voluntaryExit))
  );
  this.logger.verbose(
    `Publishing voluntary exit for validator #${voluntaryExit.message.validatorIndex}`
  );
}
