/**
 * @module network/gossip
 */

import {Gossip} from "../gossip";
import {IGossipMessage} from "../interface";
import {handleGossipMessage} from "../utils";
import {VoluntaryExit} from "@chainsafe/eth2.0-types";
import {GossipEvent} from "../constants";

export function handleIncomingVoluntaryExit(this: Gossip, msg: IGossipMessage): void {
  try {
    const voluntaryExit = handleGossipMessage<VoluntaryExit>(msg, this.config.types.VoluntaryExit);
    this.logger.verbose(
      `Received voluntary exit for validator #${voluntaryExit.validatorIndex}`
    );
    this.emit(GossipEvent.VOLUNTARY_EXIT, voluntaryExit);
  } catch (e) {
    this.logger.warn("Incoming voluntary exit error", e);
  }
}
