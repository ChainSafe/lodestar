/**
 * @module network/gossip
 */

import {IGossipMessage} from "../interface";
import {AttesterSlashing} from "@chainsafe/eth2.0-types";
import {handleGossipMessage} from "../utils";
import {Gossip} from "../gossip";
import {GossipEvent} from "../constants";

export function handleIncomingAttesterSlashing(this: Gossip, msg: IGossipMessage): void {
  try {
    const attesterSlashing = handleGossipMessage<AttesterSlashing>(msg, this.config.types.AttesterSlashing);
    this.logger.verbose(
      "Received attester slashing"
    );
    this.emit(GossipEvent.ATTESTER_SLASHING, attesterSlashing);
  } catch (e) {
    this.logger.warn("Incoming attester slashing error", e);
  }
}