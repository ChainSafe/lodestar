/**
 * @module chain/stateTransition/util
 */

import {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0, Slot, ssz} from "@chainsafe/lodestar-types";

/**
 * Check if [[data1]] and [[data2]] are slashable according to Casper FFG rules.
 */
export function isSlashableAttestationData(data1: phase0.AttestationData, data2: phase0.AttestationData): boolean {
  return (
    // Double vote
    (!ssz.phase0.AttestationData.equals(data1, data2) && data1.target.epoch === data2.target.epoch) ||
    // Surround vote
    (data1.source.epoch < data2.source.epoch && data2.target.epoch < data1.target.epoch)
  );
}

export function isValidAttestationSlot(attestationSlot: Slot, currentSlot: Slot): boolean {
  return (
    attestationSlot + MIN_ATTESTATION_INCLUSION_DELAY <= currentSlot && currentSlot <= attestationSlot + SLOTS_PER_EPOCH
  );
}
