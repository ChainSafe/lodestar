/**
 * @module network/gossip
 */

import {ProposerSlashing} from "@chainsafe/lodestar-types";
import {getGossipTopic} from "../utils";
import {Gossip} from "../gossip";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";

export async function handleIncomingProposerSlashing(this: Gossip, obj: GossipObject): Promise<void> {
  try {
    const proposerSlashing = obj as ProposerSlashing;
    this.logger.verbose(
      `Received slashing for proposer #${proposerSlashing.proposerIndex}`
    );
    this.emit(GossipEvent.PROPOSER_SLASHING, proposerSlashing);
  } catch (e) {
    this.logger.warn("Incoming proposer slashing error", e);
  }
}

export async function publishProposerSlashing(this: Gossip, proposerSlashing: ProposerSlashing): Promise<void> {
  await this.pubsub.publish(
    getGossipTopic(GossipEvent.PROPOSER_SLASHING),
    Buffer.from(this.config.types.ProposerSlashing.serialize(proposerSlashing))
  );
  this.logger.verbose(
    `Publishing proposer slashing for validator #${proposerSlashing.proposerIndex}`
  );
}
