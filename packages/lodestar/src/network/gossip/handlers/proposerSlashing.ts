/**
 * @module network/gossip
 */

import {IGossipMessage} from "../interface";
import {ProposerSlashing} from "@chainsafe/eth2.0-types";
import {handleGossipMessage} from "../utils";
import {Gossip} from "../gossip";
import {GossipEvent} from "../constants";

export function handleIncomingProposerSlashing(this: Gossip, msg: IGossipMessage): void {
  try {
    const proposerSlashing = handleGossipMessage<ProposerSlashing>(msg, this.config.types.ProposerSlashing);
    this.logger.verbose(
      `Received slashing for proposer #${proposerSlashing.proposerIndex}`
    );
    this.emit(GossipEvent.PROPOSER_SLASHING, proposerSlashing);
  } catch (e) {
    this.logger.warn("Incoming proposer slashing error", e);
  }
}