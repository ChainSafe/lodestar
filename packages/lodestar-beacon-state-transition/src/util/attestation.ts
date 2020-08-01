/**
 * @module chain/stateTransition/util
 */

import {BitList} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";
import {
  Attestation,
  ATTESTATION_SUBNET_COUNT,
  AttestationData,
  BeaconState,
  IndexedAttestation,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {DomainType,} from "../constants";
import {isSorted} from "@chainsafe/lodestar-utils";
import {getDomain} from "./domain";
import {getBeaconCommittee, getCommitteeCountAtSlot} from "./committee";
import {computeSigningRoot} from "./signingRoot";
import {computeSlotsSinceEpochStart} from "./slot";


/**
 * Check if [[data1]] and [[data2]] are slashable according to Casper FFG rules.
 */
export function isSlashableAttestationData(
  config: IBeaconConfig,
  data1: AttestationData,
  data2: AttestationData
): boolean {
  return (
    // Double vote
    (!config.types.AttestationData.equals(data1, data2)
      && data1.target.epoch === data2.target.epoch) ||
    // Surround vote
    (data1.source.epoch < data2.source.epoch &&
      data2.target.epoch < data1.target.epoch)
  );
}

/**
 * Check if [[indexedAttestation]] has valid indices and signature.
 */
export function isValidIndexedAttestation(
  config: IBeaconConfig,
  state: BeaconState,
  indexedAttestation: IndexedAttestation,
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
  const domain = getDomain(config, state, DomainType.BEACON_ATTESTER, indexedAttestation.data.target.epoch);
  const signingRoot = computeSigningRoot(config, config.types.AttestationData, indexedAttestation.data, domain);
  //  Verify aggregate signature
  if (verifySignature && !bls.verifyAggregate(
    pubKeys,
    signingRoot,
    indexedAttestation.signature.valueOf() as Uint8Array,
  )) {
    return false;
  }
  return true;
}

/**
 * Return the sorted attesting indices corresponding to [[data]] and [[bits]].
 */
export function getAttestingIndices(
  config: IBeaconConfig,
  state: BeaconState,
  data: AttestationData,
  bits: BitList
): ValidatorIndex[] {
  const committee = getBeaconCommittee(config, state, data.slot, data.index);
  // Find the participating attesters in the committee
  return getAttestingIndicesFromCommittee(committee, bits);
}

/**
 * Return the sorted attesting indices corresponding to [[data]] and [[bits]].
 */
export function getAttestingIndicesFromCommittee(
  committee: ValidatorIndex[],
  bits: BitList
): ValidatorIndex[] {
  // Find the participating attesters in the committee
  return committee.filter((_, i) => bits[i]).sort((a, b) => a - b);
}

/**
 * Return the indexed attestation corresponding to [[attestation]].
 */
export function getIndexedAttestation(
  config: IBeaconConfig,
  state: BeaconState,
  attestation: Attestation
): IndexedAttestation {
  const attestingIndices =
    getAttestingIndices(config, state, attestation.data, attestation.aggregationBits);
  const sortedAttestingIndices = attestingIndices.sort(
    (index1: ValidatorIndex, index2: ValidatorIndex) => index1 - index2);
  return {
    attestingIndices: sortedAttestingIndices,
    data: attestation.data,
    signature: attestation.signature,
  };
}

export function isValidAttestationSlot(
  config: IBeaconConfig,
  attestationSlot: Slot,
  currentSlot: Slot
): boolean {
  return (
    attestationSlot + config.params.MIN_ATTESTATION_INCLUSION_DELAY <= currentSlot &&
    currentSlot <= attestationSlot + config.params.SLOTS_PER_EPOCH
  );
}

export function isUnaggregatedAttestation(attestation: Attestation): boolean {
  const aggregationBits = attestation.aggregationBits;
  let count = 0;
  for (let i = 0; i < aggregationBits.length; i++) {
    if (aggregationBits[i]) {
      count++;
    }
  }
  return count === 1;
}
