/**
 * @module network/gossip
 */

import {IGossipMessage} from "../interface";
import {Gossip} from "../gossip";
import {handleGossipMessage} from "../utils";
import {GossipEvent} from "../constants";
import {AggregateAndProof} from "@chainsafe/eth2.0-types";
import {toHex} from "@chainsafe/eth2.0-utils";

export function handleIncomingAggregateAndProof(this: Gossip, msg: IGossipMessage): void {
  try {
    const aggregateAndProof = handleGossipMessage<AggregateAndProof>(msg, this.config.types.AggregateAndProof);
    this.logger.verbose(
      `Received AggregateAndProof from validator #${aggregateAndProof.index}`+
        ` for target ${toHex(aggregateAndProof.aggregate.data.target.root)}`
    );
    this.emit(GossipEvent.AGGREGATE_AND_PROOF, aggregateAndProof);
  } catch (e) {
    this.logger.warn("Incoming aggregate and proof error", e);
  }
}