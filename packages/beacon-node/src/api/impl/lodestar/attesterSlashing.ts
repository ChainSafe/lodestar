import {ForkSeq} from "@lodestar/params";
import {AttesterSlashing, IndexedAttestation, IndexedAttestationBigint, phase0, ssz} from "@lodestar/types";

/**
 * Check if two attestation data are slashable according to Casper FFG rules.
 *
 * Similar to isSlashableAttestationData in state-transition/util/attestation.ts
 * but operates on non-bigint types and checks surround votes in both directions,
 * since we're detecting slashable pairs rather than validating an already-ordered slashing.
 */
export function isSlashableAttestationPair(data1: phase0.AttestationData, data2: phase0.AttestationData): boolean {
  // Double vote
  if (!ssz.phase0.AttestationData.equals(data1, data2) && data1.target.epoch === data2.target.epoch) return true;

  // Surround vote, bidirectional
  if (data1.source.epoch < data2.source.epoch && data2.target.epoch < data1.target.epoch) return true;
  if (data2.source.epoch < data1.source.epoch && data1.target.epoch < data2.target.epoch) return true;

  return false;
}

/**
 * Find all slashable pairs within a list of IndexedAttestations and
 * construct AttesterSlashing objects for each.
 */
export function getAttesterSlashingsFromIndexedAttestations(
  fork: ForkSeq,
  indexedAttestations: IndexedAttestation[]
): AttesterSlashing[] {
  const slashings: AttesterSlashing[] = [];

  for (let i = 0; i < indexedAttestations.length; i++) {
    const att1 = indexedAttestations[i];

    for (let j = i + 1; j < indexedAttestations.length; j++) {
      const att2 = indexedAttestations[j];

      if (!isSlashableAttestationPair(att1.data, att2.data)) continue;
      if (!hasIntersection(att1.attestingIndices, att2.attestingIndices)) continue;

      slashings.push({
        attestation1: toIndexedAttestationBigint(att1, fork),
        attestation2: toIndexedAttestationBigint(att2, fork),
      });
    }
  }

  return slashings;
}

/**
 * Check if two sorted arrays share at least one common element.
 * attestingIndices are sorted per spec.
 */
function hasIntersection(indices1: number[], indices2: number[]): boolean {
  let i = 0;
  let j = 0;

  while (i < indices1.length && j < indices2.length) {
    if (indices1[i] === indices2[j]) {
      return true;
    }
    if (indices1[i] < indices2[j]) i++;
    else j++;
  }

  return false;
}

/**
 * Convert IndexedAttestation to IndexedAttestationBigint via SSZ roundtrip.
 * Both types share the same binary layout — only the JS numeric representation differs.
 */
function toIndexedAttestationBigint(att: IndexedAttestation, fork: ForkSeq): IndexedAttestationBigint {
  const sszType = fork >= ForkSeq.electra ? ssz.electra.IndexedAttestation : ssz.phase0.IndexedAttestation;
  const sszTypeBigint =
    fork >= ForkSeq.electra ? ssz.electra.IndexedAttestationBigint : ssz.phase0.IndexedAttestationBigint;
  return sszTypeBigint.deserialize(sszType.serialize(att));
}
