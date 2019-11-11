/**
 * @module network/gossip
 */

import {Gossip} from "../gossip";
import {IGossipMessage} from "../interface";
import {handleGossipMessage} from "../utils";
import {Attestation} from "@chainsafe/eth2.0-types";
import {toHex} from "@chainsafe/eth2.0-utils";
import {GossipEvent} from "../constants";

export function handleIncomingAttestation(this: Gossip, msg: IGossipMessage): void {
  try {
    const attestation = handleGossipMessage<Attestation>(msg, this.config.types.Attestation);
    this.logger.verbose(
      `Received attestation for block ${toHex(attestation.data.beaconBlockRoot)}`
        +` (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
    );
    this.emit(GossipEvent.ATTESTATION, attestation);
  } catch (e) {
    this.logger.warn("Incoming attestation error", e);
  }
}
