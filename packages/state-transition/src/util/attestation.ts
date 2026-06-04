import {ForkSeq, MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  AttesterSlashing,
  IndexedAttestation,
  IndexedAttestationBigint,
  Slot,
  ValidatorIndex,
  phase0,
  ssz,
} from "@lodestar/types";

/**
 * Check if [[data1]] and [[data2]] are slashable according to Casper FFG rules.
 */
export function isSlashableAttestationData(
  data1: phase0.AttestationDataBigint,
  data2: phase0.AttestationDataBigint
): boolean {
  return (
    // Double vote
    (!ssz.phase0.AttestationDataBigint.equals(data1, data2) && data1.target.epoch === data2.target.epoch) ||
    // Surround vote
    (data1.source.epoch < data2.source.epoch && data2.target.epoch < data1.target.epoch)
  );
}

export function isValidAttestationSlot(attestationSlot: Slot, currentSlot: Slot): boolean {
  return (
    attestationSlot + MIN_ATTESTATION_INCLUSION_DELAY <= currentSlot && currentSlot <= attestationSlot + SLOTS_PER_EPOCH
  );
}

/**
 * Compute the intersection of two sorted validator index lists.
 * Both inputs must be sorted in ascending order (per spec).
 */
export function getIntersectingIndices(indices1: ValidatorIndex[], indices2: ValidatorIndex[]): ValidatorIndex[] {
  const indices: ValidatorIndex[] = [];
  const alreadyPresent = new Set(indices1);
  for (let i = 0, len = indices2.length; i < len; i++) {
    const index = indices2[i];
    if (alreadyPresent.has(index)) {
      indices.push(index);
    }
  }
  return indices;
}

export function getAttesterSlashableIndices(attesterSlashing: AttesterSlashing): ValidatorIndex[] {
  return getIntersectingIndices(
    attesterSlashing.attestation1.attestingIndices,
    attesterSlashing.attestation2.attestingIndices
  );
}

/**
 * Convert IndexedAttestation to IndexedAttestationBigint via SSZ roundtrip.
 * Both types share the same binary layout — only the JS numeric representation differs.
 */
export function toIndexedAttestationBigint(att: IndexedAttestation, fork: ForkSeq): IndexedAttestationBigint {
  const sszType = fork >= ForkSeq.electra ? ssz.electra.IndexedAttestation : ssz.phase0.IndexedAttestation;
  const sszTypeBigint =
    fork >= ForkSeq.electra ? ssz.electra.IndexedAttestationBigint : ssz.phase0.IndexedAttestationBigint;
  return sszTypeBigint.deserialize(sszType.serialize(att));
}
