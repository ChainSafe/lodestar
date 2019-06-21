/**
 * @module chain/stateTransition/util
 */

import {hashTreeRoot} from "@chainsafe/ssz";
import assert from "assert";

import {Domain, MAX_INDICES_PER_ATTESTATION} from "../../../constants";

import {
  Attestation,
  AttestationData,
  AttestationDataAndCustodyBit,
  BeaconState,
  bool,
  bytes,
  IndexedAttestation,
  ValidatorIndex,
} from "../../../types";

import bls from "@chainsafe/bls-js";

import {intDiv} from "../../../util/math";

import {slotToEpoch} from "./epoch";

import {getCrosslinkCommittee} from "./crosslinkCommittee";

import {getDomain} from "./misc";
import {PublicKey} from "@chainsafe/bls-js/lib/publicKey";


/**
 * Return the sorted attesting indices corresponding to ``attestation_data`` and ``bitfield``.
 */
export function getAttestingIndices(
  state: BeaconState,
  attestationData: AttestationData,
  bitfield: bytes
): ValidatorIndex[] {
  const crosslinkCommittee =
    getCrosslinkCommittee(state, attestationData.targetEpoch, attestationData.crosslink.shard);
  assert(verifyBitfield(bitfield, crosslinkCommittee.length));

  // Find the participating attesters in the committee
  return crosslinkCommittee
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

// SPEC 0.7
// def validate_indexed_attestation(state: BeaconState, indexed_attestation: IndexedAttestation) -> None:
//   """
// Verify validity of ``indexed_attestation``.
// """
// bit_0_indices = indexed_attestation.custody_bit_0_indices
// bit_1_indices = indexed_attestation.custody_bit_1_indices
//
// # Verify no index has custody bit equal to 1 [to be removed in phase 1]
// assert len(bit_1_indices) == 0
// # Verify max number of indices
// assert len(bit_0_indices) + len(bit_1_indices) <= MAX_INDICES_PER_ATTESTATION
// # Verify index sets are disjoint
// assert len(set(bit_0_indices).intersection(bit_1_indices)) == 0
// # Verify indices are sorted
// assert bit_0_indices == sorted(bit_0_indices) and bit_1_indices == sorted(bit_1_indices)
// # Verify aggregate signature
// assert bls_verify_multiple(
//   pubkeys=[
//     bls_aggregate_pubkeys([state.validator_registry[i].pubkey for i in bit_0_indices]),
//   bls_aggregate_pubkeys([state.validator_registry[i].pubkey for i in bit_1_indices]),
// ],
// message_hashes=[
//   hash_tree_root(AttestationDataAndCustodyBit(data=indexed_attestation.data, custody_bit=0b0)),
//   hash_tree_root(AttestationDataAndCustodyBit(data=indexed_attestation.data, custody_bit=0b1)),
// ],
//   signature=indexed_attestation.signature,
//   domain=get_domain(state, DOMAIN_ATTESTATION, indexed_attestation.data.target_epoch),
// )

export function validateIndexedAttestation(
  state: BeaconState,
  indexedAttestation: IndexedAttestation
): bool {
  const bit0Indices = indexedAttestation.custodyBit0Indices;
  const bit1Indices = indexedAttestation.custodyBit1Indices;

  const sortedBit0Indices = bit0Indices.slice().sort((a, b) => a - b);
  const sortedBit1Indices = bit1Indices.slice().sort((a, b) => a - b);

  const isSortedBit0Indices = bit0Indices.every((index, i) => index === sortedBit0Indices[i]);
  const isSortedBit1Indices = bit1Indices.every((index, i) => index === sortedBit1Indices[i]);

  let intersection = new Set();

  for(let x of new Set(bit0Indices)) {
    if(bit1Indices.includes(x)) {
      intersection.add(x);
    }
  }

  // Verify no index has custody bit equal to 1 [to be removed in phase 1]
  assert(bit1Indices.length == 0);
  // Verify max number of indices
  assert ((bit0Indices.length + bit1Indices.length) <= MAX_INDICES_PER_ATTESTATION);
  //  Verify index sets are disjoint
  assert (intersection.size == 0);
  //  Verify indices are sorted
  assert (isSortedBit0Indices && isSortedBit1Indices);


  //  Verify aggregate signature
  return bls.verifyMultiple(
    [
      bls.aggregatePubkeys(sortedBit0Indices.map((i) => state.validatorRegistry[i].pubkey)),
      bls.aggregatePubkeys(sortedBit1Indices.map((i) => state.validatorRegistry[i].pubkey)),
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
    getDomain(state, Domain.ATTESTATION, slotToEpoch(indexedAttestation.data.targetEpoch)),
  );
}
