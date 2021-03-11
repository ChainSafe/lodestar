/**
 * @module chain/stateTransition/util
 */

import bls from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  ATTESTATION_SUBNET_COUNT,
  phase0,
  Slot,
  ValidatorIndex,
  CommitteeIndex,
  allForks,
} from "@chainsafe/lodestar-types";
import {isSorted} from "@chainsafe/lodestar-utils";
import {BitList, List} from "@chainsafe/ssz";
import {getBeaconCommittee, getCommitteeCountAtSlot} from "./committee";
import {getDomain} from "./domain";
import {computeSigningRoot} from "./signingRoot";
import {computeSlotsSinceEpochStart} from "./slot";

/**
 * Check if [[data1]] and [[data2]] are slashable according to Casper FFG rules.
 */
export function isSlashableAttestationData(
  config: IBeaconConfig,
  data1: phase0.AttestationData,
  data2: phase0.AttestationData
): boolean {
  return (
    // Double vote
    (!config.types.phase0.AttestationData.equals(data1, data2) && data1.target.epoch === data2.target.epoch) ||
    // Surround vote
    (data1.source.epoch < data2.source.epoch && data2.target.epoch < data1.target.epoch)
  );
}

/**
 * Check if [[indexedAttestation]] has valid indices and signature.
 */
export function isValidIndexedAttestation(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  indexedAttestation: phase0.IndexedAttestation,
  verifySignature = true
): boolean {
  const indices = Array.from(indexedAttestation.attestingIndices);

  if (indices.length === 0) {
    return false;
  }

  //  Verify indices are sorted and unique
  if (!isSorted([...new Set(indices).values()])) {
    return false;
  }
  const pubKeys = indices.map((i) => state.validators[i].pubkey.valueOf() as Uint8Array);
  const domain = getDomain(config, state, config.params.DOMAIN_BEACON_ATTESTER, indexedAttestation.data.target.epoch);
  const signingRoot = computeSigningRoot(config, config.types.phase0.AttestationData, indexedAttestation.data, domain);
  //  Verify aggregate signature
  if (
    verifySignature &&
    !bls.verifyAggregate(pubKeys, signingRoot, indexedAttestation.signature.valueOf() as Uint8Array)
  ) {
    return false;
  }
  return true;
}

/**
 * Return the sorted attesting indices corresponding to [[data]] and [[bits]].
 */
export function getAttestingIndices(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  data: phase0.AttestationData,
  bits: BitList
): ValidatorIndex[] {
  const committee = getBeaconCommittee(config, state, data.slot, data.index);
  // Find the participating attesters in the committee
  return getAttestingIndicesFromCommittee(committee, bits);
}

/**
 * Return the sorted attesting indices corresponding to [[data]] and [[bits]].
 */
export function getAttestingIndicesFromCommittee(committee: ValidatorIndex[], bits: BitList): ValidatorIndex[] {
  // Find the participating attesters in the committee
  return committee.filter((_, i) => bits[i]).sort((a, b) => a - b);
}

/**
 * Return the indexed attestation corresponding to [[attestation]].
 */
export function getIndexedAttestation(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  attestation: phase0.Attestation
): phase0.IndexedAttestation {
  const attestingIndices = getAttestingIndices(config, state, attestation.data, attestation.aggregationBits);
  const sortedAttestingIndices = attestingIndices.sort(
    (index1: ValidatorIndex, index2: ValidatorIndex) => index1 - index2
  );
  return {
    attestingIndices: sortedAttestingIndices as List<number>,
    data: attestation.data,
    signature: attestation.signature,
  };
}

export function isValidAttestationSlot(config: IBeaconConfig, attestationSlot: Slot, currentSlot: Slot): boolean {
  return (
    attestationSlot + config.params.MIN_ATTESTATION_INCLUSION_DELAY <= currentSlot &&
    currentSlot <= attestationSlot + config.params.SLOTS_PER_EPOCH
  );
}

export function isUnaggregatedAttestation(attestation: phase0.Attestation): boolean {
  const aggregationBits = attestation.aggregationBits;
  let count = 0;
  for (let i = 0; i < aggregationBits.length; i++) {
    if (aggregationBits[i]) {
      count++;
    }
  }
  return count === 1;
}

/**
 * Compute the correct subnet for an attestation for Phase 0.
 */
export function computeSubnetForAttestation(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  attestation: phase0.Attestation
): number {
  const {slot, index} = attestation.data;
  return computeSubnetForSlot(config, state, slot, index);
}

/**
 * Compute the correct subnet for a slot/committee index for Phase 0.
 */
export function computeSubnetForSlot(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  slot: number,
  committeeIndex: number
): number {
  const committeesAtSlot = getCommitteeCountAtSlot(config, state, slot);
  return computeSubnetForCommitteesAtSlot(config, slot, committeesAtSlot, committeeIndex);
}

export function computeSubnetForCommitteesAtSlot(
  config: IBeaconConfig,
  slot: Slot,
  committeesAtSlot: number,
  committeeIndex: CommitteeIndex
): number {
  const slotsSinceEpochStart = computeSlotsSinceEpochStart(config, slot);
  const committeesSinceEpochStart = committeesAtSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}
