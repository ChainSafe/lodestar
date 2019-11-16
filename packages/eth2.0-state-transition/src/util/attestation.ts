/**
 * @module chain/stateTransition/util
 */

import {equals, hashTreeRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";
import {BitList} from "@chainsafe/bit-utils";
import {
  Attestation,
  AttestationData,
  BeaconState,
  IndexedAttestation,
  Slot,
  ValidatorIndex,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {DomainType,} from "../constants";
import {isSorted} from "@chainsafe/eth2.0-utils";
import {getDomain} from "./domain";
import {getBeaconCommittee} from "./committee";



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
    (!equals(data1, data2, config.types.AttestationData)
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
  indexedAttestation: IndexedAttestation
): boolean {
  const indices = indexedAttestation.attestingIndices;

  //  Verify indices are sorted
  if (!isSorted(indices)) {
    return false;
  }
  //  Verify aggregate signature
  if (!bls.verify(
    bls.aggregatePubkeys(indices.map((i) => state.validators[i].pubkey)),
    hashTreeRoot(indexedAttestation.data, config.types.AttestationData),
    indexedAttestation.signature,
    getDomain(config, state, DomainType.BEACON_ATTESTER, indexedAttestation.data.target.epoch)
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
  return committee.filter((_, i) => bits.getBit(i)).sort((a, b) => a - b);
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
