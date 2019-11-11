/**
 * @module network/gossip
 */

import {IGossipMessage} from "../interface";
import {Gossip} from "../gossip";
import {handleGossipMessage} from "../utils";
import {GossipEvent} from "../constants";

export function handleIncomingAggregateAndProof(this: Gossip, msg: IGossipMessage): void {
  try {
    const aggregateAndProof = handleGossipMessage<AggregateAndProof>(msg, this.config.types.AggregateAndProof);
    // this.logger.verbose(
    //   `Received aggregate and proof for block ${toHex(attestation.data.beaconBlockRoot)}`
    //     +` (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
    // );
    this.emit(GossipEvent.AGGREGATE_AND_PROOF, aggregateAndProof);
  } catch (e) {
    this.logger.warn("Incoming aggregate and proof error", e);
  }
}