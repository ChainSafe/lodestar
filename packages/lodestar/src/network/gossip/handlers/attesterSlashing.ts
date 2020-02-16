/**
 * @module network/gossip
 */

import {AttesterSlashing} from "@chainsafe/eth2.0-types";
import {getGossipTopic} from "../utils";
import {Gossip} from "../gossip";
import {GossipEvent} from "../constants";
import {serialize} from "@chainsafe/ssz";
import {GossipObject} from "../interface";

export async function handleIncomingAttesterSlashing(this: Gossip, obj: GossipObject): Promise<void> {
  try {
    const attesterSlashing = obj as AttesterSlashing;
    this.logger.verbose(
      "Received attester slashing"
    );
    this.emit(GossipEvent.ATTESTER_SLASHING, attesterSlashing);
  } catch (e) {
    this.logger.warn("Incoming attester slashing error", e);
  }
}

export async function publishAttesterSlashing(this: Gossip, attesterSlashing: AttesterSlashing): Promise<void> {
  await this.pubsub.publish(
    getGossipTopic(GossipEvent.PROPOSER_SLASHING),
    serialize(this.config.types.AttesterSlashing, attesterSlashing)
  );
  this.logger.verbose(
    "Publishing attester slashing"
  );
}
