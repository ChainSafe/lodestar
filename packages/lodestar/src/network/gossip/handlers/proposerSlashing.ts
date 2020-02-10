/**
 * @module network/gossip
 */

import {IGossipMessage, IGossipMessageValidator} from "../interface";
import {ProposerSlashing} from "@chainsafe/eth2.0-types";
import {deserializeGossipMessage, getGossipTopic} from "../utils";
import {Gossip, GossipHandlerFn} from "../gossip";
import {GossipEvent} from "../constants";
import {serialize} from "@chainsafe/ssz";

export function getIncomingProposerSlashingHandler(validator: IGossipMessageValidator): GossipHandlerFn {
  return async function handleIncomingProposerSlashing(this: Gossip, msg: IGossipMessage): Promise<void> {
    try {
      const proposerSlashing = deserializeGossipMessage<ProposerSlashing>(msg, this.config.types.ProposerSlashing);
      this.logger.verbose(
        `Received slashing for proposer #${proposerSlashing.proposerIndex}`
      );
      if (await validator.isValidIncomingProposerSlashing(proposerSlashing)) {
        this.emit(GossipEvent.PROPOSER_SLASHING, proposerSlashing);
      }
    } catch (e) {
      this.logger.warn("Incoming proposer slashing error", e);
    }
  };
}

export async function publishProposerSlashing(this: Gossip, proposerSlashing: ProposerSlashing): Promise<void> {
  await this.pubsub.publish(
    getGossipTopic(GossipEvent.PROPOSER_SLASHING),
    serialize(this.config.types.ProposerSlashing, proposerSlashing)
  );
  this.logger.verbose(
    `Publishing proposer slashing for validator #${proposerSlashing.proposerIndex}`
  );
}
