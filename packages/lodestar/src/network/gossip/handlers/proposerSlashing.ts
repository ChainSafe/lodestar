/**
 * @module network/gossip
 */

import {phase0} from "@chainsafe/lodestar-types";
import {getGossipTopic} from "../utils";
import {Gossip} from "../gossip";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";

export function handleIncomingProposerSlashing(this: Gossip, obj: GossipObject): void {
  try {
    const proposerSlashing = obj as phase0.ProposerSlashing;
    this.logger.verbose("Received slashing", {proposer: proposerSlashing.signedHeader1.message.proposerIndex});
    this.emit(GossipEvent.PROPOSER_SLASHING, proposerSlashing);
  } catch (e) {
    this.logger.warn("Incoming proposer slashing error", e);
  }
}

export async function publishProposerSlashing(this: Gossip, proposerSlashing: phase0.ProposerSlashing): Promise<void> {
  const forkDigestValue = this.getForkDigest(proposerSlashing.signedHeader1.message.slot);

  await this.pubsub.publish(
    getGossipTopic(GossipEvent.PROPOSER_SLASHING, forkDigestValue),
    Buffer.from(this.config.types.phase0.ProposerSlashing.serialize(proposerSlashing))
  );

  this.logger.verbose("Publishing proposer slashing", {
    validator: proposerSlashing.signedHeader1.message.proposerIndex,
  });
}
