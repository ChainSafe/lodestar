/**
 * @module chain/stateTransition/util
 */

import {hashTreeRoot} from "@chainsafe/ssz";
import assert from "assert";
import bls from "@chainsafe/bls-js";
import {PublicKey} from "@chainsafe/bls-js/lib/publicKey";

import {Domain, MAX_INDICES_PER_ATTESTATION} from "@chainsafe/eth2-types"
import {
  Attestation,
  AttestationData,
  AttestationDataAndCustodyBit,
  BeaconState,
  bool,
  bytes,
  IndexedAttestation,
  ValidatorIndex,
} from "@chainsafe/eth2-types";

import {intDiv} from "../../../util/math";
import {isSorted} from "../../../util/sort";

import {slotToEpoch} from "./epoch";
import {getCrosslinkCommittee} from "./crosslinkCommittee";
import {getDomain} from "./misc";


/**
 * Return the sorted attesting indices corresponding to ``attestation_data`` and ``bitfield``.
 */
export function getAttestingIndices(
  state: BeaconState,
  attestationData: AttestationData,
  bitfield: bytes
): ValidatorIndex[] {
  const committee =
    getCrosslinkCommittee(state, attestationData.targetEpoch, attestationData.crosslink.shard);
  assert(verifyBitfield(bitfield, committee.length));

  // Find the participating attesters in the committee
  return committee
    .filter((_, i) =>  getBitfieldBit(bitfield, i) === 1)
    .sort((a, b) => a - b);
}

/**
 * Returns the ith bit in bitfield
 */
export function getBitfieldBit(bitfield: bytes, i: number): number {
  const bit = i % 8;
  const byte = intDiv(i,  8);
  return (bitfield[byte] >> bit) % 2;
}

/**
 * Verify ``bitfield`` against the ``committee_size``.
 */
export function verifyBitfield(bitfield: bytes, committeeSize: number): boolean {
  if (bitfield.length !== intDiv(committeeSize + 7, 8)) {
    return false;
  }

  // Check `bitfield` is padded with zero bits only
  for (let i = committeeSize; i < bitfield.length * 8; i++) {
    if (getBitfieldBit(bitfield, i) === 0b1) {
      return false;
    }
  }
  return true;
}

/**
 * Convert ``attestation`` to (almost) indexed-verifiable form.
 */
export function convertToIndexed(state: BeaconState, attestation: Attestation): IndexedAttestation {
  const attestingIndices =
    getAttestingIndices(state, attestation.data, attestation.aggregationBitfield);
  const custodyBit1Indices =
    getAttestingIndices(state, attestation.data, attestation.custodyBitfield);
  const custodyBit0Indices = attestingIndices.filter((i) => !custodyBit1Indices.includes(i));

  return {
    custodyBit0Indices,
    custodyBit1Indices,
    data: attestation.data,
    signature: attestation.signature,
  };
}

/**
 * Verify validity of ``indexed_attestation`` fields.
 */
export function validateIndexedAttestation(
  state: BeaconState,
  indexedAttestation: IndexedAttestation
): void {
  const bit0Indices = indexedAttestation.custodyBit0Indices;
  const bit1Indices = indexedAttestation.custodyBit1Indices;

  // Verify no index has custody bit equal to 1 [to be removed in phase 1]
  assert(bit1Indices.length == 0);
  // Verify max number of indices
  assert(bit0Indices.length + bit1Indices.length <= MAX_INDICES_PER_ATTESTATION);
  //  Verify index sets are disjoint
  const intersection = bit0Indices.filter((index) => bit1Indices.includes(index));
  assert(intersection.length == 0);
  //  Verify indices are sorted
  assert(isSorted(bit0Indices) && isSorted(bit1Indices));
  //  Verify aggregate signature
  //console.log(JSON.stringify(indexedAttestation, null, 2));
  assert(bls.verifyMultiple(
    [
      bls.aggregatePubkeys(bit0Indices.map((i) => state.validatorRegistry[i].pubkey)),
      bls.aggregatePubkeys(bit1Indices.map((i) => state.validatorRegistry[i].pubkey)),
    ], [
      hashTreeRoot({
        data: indexedAttestation.data,
        custodyBit: false,
      }, AttestationDataAndCustodyBit),
      hashTreeRoot({
        data: indexedAttestation.data,
        custodyBit: true,
      }, AttestationDataAndCustodyBit),
    ],
    indexedAttestation.signature,
    getDomain(state, Domain.ATTESTATION, indexedAttestation.data.targetEpoch),
  ));
}
