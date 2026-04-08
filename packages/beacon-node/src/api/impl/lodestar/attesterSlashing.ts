import {ForkSeq} from "@lodestar/params";
import {isSlashableAttestationData} from "@lodestar/state-transition";
import {AttesterSlashing, IndexedAttestation, IndexedAttestationBigint, ssz} from "@lodestar/types";

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
    for (let j = i + 1; j < indexedAttestations.length; j++) {
      // Order by source epoch so the surrounding attestation is always first,
      // matching what isSlashableAttestationData expects (one-directional check).
      const [first, second] =
        indexedAttestations[j].data.source.epoch < indexedAttestations[i].data.source.epoch
          ? [indexedAttestations[j], indexedAttestations[i]]
          : [indexedAttestations[i], indexedAttestations[j]];

      if (!hasIntersection(first.attestingIndices, second.attestingIndices)) continue;

      const firstBigint = toIndexedAttestationBigint(first, fork);
      const secondBigint = toIndexedAttestationBigint(second, fork);

      if (!isSlashableAttestationData(firstBigint.data, secondBigint.data)) continue;

      slashings.push({
        attestation1: firstBigint,
        attestation2: secondBigint,
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
