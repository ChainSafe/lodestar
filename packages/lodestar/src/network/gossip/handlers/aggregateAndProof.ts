/**
 * @module network/gossip
 */

import {toHexString} from "@chainsafe/ssz";
import {AggregateAndProof} from "@chainsafe/lodestar-types";
import {Gossip} from "../gossip";
import {getGossipTopic} from "../utils";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";

export async function handleIncomingAggregateAndProof(this: Gossip, obj: GossipObject): Promise<void> {
  try {
    const aggregateAndProof = obj as AggregateAndProof;
    this.logger.verbose(
      `Received AggregateAndProof from validator #${aggregateAndProof.aggregatorIndex}`+
        ` for target ${toHexString(aggregateAndProof.aggregate.data.target.root)}`
    );
    this.emit(GossipEvent.AGGREGATE_AND_PROOF, aggregateAndProof);
  } catch (e) {
    this.logger.warn("Incoming aggregate and proof error", e);
  }
}

export async function publishAggregatedAttestation(this: Gossip, aggregateAndProof: AggregateAndProof): Promise<void> {
  await Promise.all([
    this.pubsub.publish(
      getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF),
      Buffer.from(this.config.types.AggregateAndProof.serialize(aggregateAndProof))
    ),
    //to be backward compatible
    this.pubsub.publish(
      getGossipTopic(GossipEvent.ATTESTATION),
      Buffer.from(this.config.types.Attestation.serialize(aggregateAndProof.aggregate))
    )
  ]);

  this.logger.verbose(
    `Publishing AggregateAndProof for validator #${aggregateAndProof.aggregatorIndex}`
        + ` for target ${toHexString(aggregateAndProof.aggregate.data.target.root)}`
  );
}
