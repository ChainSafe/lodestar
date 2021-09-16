/**
 * @module chain/stateTransition/util
 */

import {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0, Slot, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";

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

export function getAttesterSlashableIndices(attesterSlashing: phase0.AttesterSlashing): ValidatorIndex[] {
  const indices: ValidatorIndex[] = [];
  const attSet1 = new Set(attesterSlashing.attestation1.attestingIndices);
  const attArr2 = attesterSlashing.attestation2.attestingIndices;
  for (let i = 0, len = attArr2.length; i < len; i++) {
    const index = attArr2[i];
    if (attSet1.has(index)) {
      indices.push(index);
    }
  }
  return indices;
}
