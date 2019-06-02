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
    getCrosslinkCommittee(state, attestationData.targetEpoch, attestationData.shard);

  assert(verifyBitfield(bitfield, crosslinkCommittee.length));

  // Find the participating attesters in the committee
  return crosslinkCommittee
    .filter((_, i) =>  getBitfieldBit(bitfield, i) === 0b1)
    .sort();
}

/**
 * Returns the ith bit in bitfield
 */
export function getBitfieldBit(bitfield: bytes, i: number): number {
  const bit = i % 8;
  const byte = intDiv(i,  8);
  return (bitfield[byte] >> bit) & 1;
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
  const custodyBit0Indices = attestingIndices.filter((i) => custodyBit1Indices.includes(i));

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
export function verifyIndexedAttestation(
  state: BeaconState,
  indexedAttestation: IndexedAttestation
): bool {
  const custodyBit0Indices = indexedAttestation.custodyBit0Indices;
  const custodyBit1Indices = indexedAttestation.custodyBit1Indices;

  // ensure no duplicate indices across custody bits
  const custodyBit0IndicesSet = new Set(custodyBit0Indices);
  const duplicates = new Set(
    custodyBit1Indices.filter((i) => custodyBit0IndicesSet.has(i))
  );
  assert(duplicates.size === 0);

  // TO BE REMOVED IN PHASE 1
  if (custodyBit1Indices.length > 0) {
    return false;
  }

  const totalAttestingIndices = custodyBit0Indices.length + custodyBit1Indices.length;
  if (!(1 <= totalAttestingIndices && totalAttestingIndices <= MAX_INDICES_PER_ATTESTATION)) {
    return false;
  }
  const sortedCustodyBit0Indices = custodyBit0Indices.slice().sort();
  if (custodyBit0Indices.every((index, i) => index === sortedCustodyBit0Indices[i])) {
    return false;
  }
  const sortedCustodyBit1Indices = custodyBit1Indices.slice().sort();
  if (custodyBit1Indices.length > 0
    && custodyBit1Indices.every((index, i) => index === sortedCustodyBit1Indices[i])) {
    return false;
  }
  return bls.verifyMultiple(
    [
      bls.aggregatePubkeys(sortedCustodyBit0Indices.map((i) => state.validatorRegistry[i].pubkey)),
      bls.aggregatePubkeys(sortedCustodyBit1Indices.map((i) => state.validatorRegistry[i].pubkey)),
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
