/**
 * @module network/gossip
 */

import {IGossipMessage} from "../interface";
import {Gossip} from "../gossip";
import {deserializeGossipMessage, getGossipTopic} from "../utils";
import {GossipEvent} from "../constants";
import {AggregateAndProof} from "@chainsafe/eth2.0-types";
import {toHex} from "@chainsafe/eth2.0-utils";
import {serialize} from "@chainsafe/ssz";
//@ts-ignore
import promisify from "promisify-es6";

export function handleIncomingAggregateAndProof(this: Gossip, msg: IGossipMessage): void {
  try {
    const aggregateAndProof = deserializeGossipMessage<AggregateAndProof>(msg, this.config.types.AggregateAndProof);
    this.logger.verbose(
      `Received AggregateAndProof from validator #${aggregateAndProof.index}`+
        ` for target ${toHex(aggregateAndProof.aggregate.data.target.root)}`
    );
    this.emit(GossipEvent.AGGREGATE_AND_PROOF, aggregateAndProof);
  } catch (e) {
    this.logger.warn("Incoming aggregate and proof error", e);
  }
}

export async function publishAggregatedAttestation(this: Gossip, aggregateAndProof: AggregateAndProof): Promise<void> {
  await Promise.all([
    promisify(this.pubsub.publish.bind(this.pubsub))(
      getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF),
      serialize(aggregateAndProof, this.config.types.AggregateAndProof)
    ),
    //to be backward compatible
    promisify(this.pubsub.publish.bind(this.pubsub))(
      getGossipTopic(GossipEvent.ATTESTATION), serialize(aggregateAndProof.aggregate, this.config.types.Attestation)
    )
  ]);
  this.logger.verbose(
    `Publishing AggregateAndProof for validator #${aggregateAndProof.index}`
        + ` for target ${toHex(aggregateAndProof.aggregate.data.target.root)}`
  );
}