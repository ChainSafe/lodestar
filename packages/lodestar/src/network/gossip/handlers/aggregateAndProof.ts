/**
 * @module network/gossip
 */

import {toHexString} from "@chainsafe/ssz";
import {SignedAggregateAndProof} from "@chainsafe/lodestar-types";
import {Gossip} from "../gossip";
import {getGossipTopic} from "../utils";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";

export async function handleIncomingAggregateAndProof(this: Gossip, obj: GossipObject): Promise<void> {
  try {
    const signedAggregateAndProof = obj as SignedAggregateAndProof;
    this.logger.verbose(
      `Received AggregateAndProof from validator #${signedAggregateAndProof.message.aggregatorIndex}`+
        ` for target ${toHexString(signedAggregateAndProof.message.aggregate.data.target.root)}`
    );
    this.emit(GossipEvent.AGGREGATE_AND_PROOF, signedAggregateAndProof);
  } catch (e) {
    this.logger.warn("Incoming aggregate and proof error", e);
  }
}

export async function publishAggregatedAttestation(
  this: Gossip, signedAggregateAndProof: SignedAggregateAndProof): Promise<void> {
  const forkDigestValue = await this.getForkDigest(signedAggregateAndProof.message.aggregate.data.slot);
  await this.pubsub.publish(
    getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, forkDigestValue),
    Buffer.from(this.config.types.SignedAggregateAndProof.serialize(signedAggregateAndProof))
  );

  this.logger.verbose(
    `Publishing SignedAggregateAndProof for validator #${signedAggregateAndProof.message.aggregatorIndex}`
        + ` for target ${toHexString(signedAggregateAndProof.message.aggregate.data.target.root)}`
  );
}
