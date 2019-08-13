/**
 * @module chain/stateTransition/util
 */

import assert from "assert";
import {hashTreeRoot, equals} from "@chainsafe/ssz";
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

import {
  DomainType,
} from "../../../constants";
import {intDiv} from "../../../util/math";
import {isSorted} from "../../../util/sort";

import {computeStartSlotOfEpoch} from "./epoch";
import {getDomain} from "./domain";
import {getCommitteeCount, getStartShard, getCrosslinkCommittee} from "./committee";


/**
 * Return the slot corresponding to the attestation [[data]].
 */
export function getAttestationDataSlot(config: IBeaconConfig, state: BeaconState, data: AttestationData): Slot {
  const epoch = data.target.epoch;
  const committeeCount = getCommitteeCount(config, state, epoch);
  const offset = (data.crosslink.shard + config.params.SHARD_COUNT - getStartShard(config, state, epoch)) % config.params.SHARD_COUNT;
  return intDiv(computeStartSlotOfEpoch(config, epoch) + offset, intDiv(committeeCount, config.params.SLOTS_PER_EPOCH));
}

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
  const bit0Indices = indexedAttestation.custodyBit0Indices;
  const bit1Indices = indexedAttestation.custodyBit1Indices;

  // Verify no index has custody bit equal to 1 [to be removed in phase 1]
  if (!(bit1Indices.length == 0)) {
    return false;
  }
  // Verify max number of indices
  if (!(bit0Indices.length + bit1Indices.length <= config.params.MAX_VALIDATORS_PER_COMMITTEE)) {
    return false;
  }
  //  Verify index sets are disjoint
  const intersection = bit0Indices.filter((index) => bit1Indices.includes(index));
  if (!(intersection.length == 0)) {
    return false;
  }
  //  Verify indices are sorted
  if (!(isSorted(bit0Indices) && isSorted(bit1Indices))) {
    return false;
  }
  //  Verify aggregate signature
  if (!(bls.verifyMultiple(
    [
      bls.aggregatePubkeys(bit0Indices.map((i) => state.validators[i].pubkey)),
      bls.aggregatePubkeys(bit1Indices.map((i) => state.validators[i].pubkey)),
    ], [
      hashTreeRoot({
        data: indexedAttestation.data,
        custodyBit: false,
      }, config.types.AttestationDataAndCustodyBit),
      hashTreeRoot({
        data: indexedAttestation.data,
        custodyBit: true,
      }, config.types.AttestationDataAndCustodyBit),
    ],
    indexedAttestation.signature,
    getDomain(config, state, DomainType.ATTESTATION, indexedAttestation.data.target.epoch),
  ))) {
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
  const committee = getCrosslinkCommittee(config, state, data.target.epoch, data.crosslink.shard);
  assert(bits.bitLength === committee.length);

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
  const custodyBit1Indices =
    getAttestingIndices(config, state, attestation.data, attestation.custodyBits);
  const custodyBit0Indices = attestingIndices.filter((i) => !custodyBit1Indices.includes(i));

  return {
    custodyBit0Indices,
    custodyBit1Indices,
    data: attestation.data,
    signature: attestation.signature,
  };
}
