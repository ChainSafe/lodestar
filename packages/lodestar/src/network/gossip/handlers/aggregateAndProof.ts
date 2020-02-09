/**
 * @module network/gossip
 */

import {toHexString} from "@chainsafe/ssz";
import {AggregateAndProof} from "@chainsafe/eth2.0-types";
import {IGossipMessage, IGossipMessageValidator} from "../interface";
import {Gossip, GossipHandlerFn} from "../gossip";
import {deserializeGossipMessage, getGossipTopic} from "../utils";
import {GossipEvent} from "../constants";
import {promisify} from "es6-promisify";

export function getIncomingAggregateAndProofHandler(validator: IGossipMessageValidator): GossipHandlerFn {
  return async function handleIncomingAggregateAndProof(this: Gossip, msg: IGossipMessage): Promise<void> {
    try {
      const aggregateAndProof = deserializeGossipMessage<AggregateAndProof>(this.config.types.AggregateAndProof, msg);
      this.logger.verbose(
        `Received AggregateAndProof from validator #${aggregateAndProof.aggregatorIndex}`+
          ` for target ${toHexString(aggregateAndProof.aggregate.data.target.root)}`
      );
      if (await validator.isValidIncomingAggregateAndProof(aggregateAndProof)) {
        this.emit(GossipEvent.AGGREGATE_AND_PROOF, aggregateAndProof);
      }
    } catch (e) {
      this.logger.warn("Incoming aggregate and proof error", e);
    }
  };
}

export async function publishAggregatedAttestation(this: Gossip, aggregateAndProof: AggregateAndProof): Promise<void> {
  await Promise.all([
    promisify<void, string, Uint8Array>(this.pubsub.publish.bind(this.pubsub))(
      getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF),
      this.config.types.AggregateAndProof.serialize(aggregateAndProof)
    ),
    //to be backward compatible
    promisify<void, string, Uint8Array>(this.pubsub.publish.bind(this.pubsub))(
      getGossipTopic(GossipEvent.ATTESTATION), this.config.types.Attestation.serialize(aggregateAndProof.aggregate)
    )
  ]);
  this.logger.verbose(
    `Publishing AggregateAndProof for validator #${aggregateAndProof.aggregatorIndex}`
        + ` for target ${toHexString(aggregateAndProof.aggregate.data.target.root)}`
  );
}
