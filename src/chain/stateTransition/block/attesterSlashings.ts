/**
 * @module chain/stateTransition/block
 */

import assert from "assert";

import {serialize} from "@chainsafe/ssz";

import {
  AttestationData,
  BeaconBlock,
  BeaconState,
  AttesterSlashing,
} from "../../../types";

import {
  MAX_ATTESTER_SLASHINGS,
} from "../../../constants";

import {
  getCurrentEpoch,
  isDoubleVote,
  isSlashableValidator,
  isSurroundVote,
  slashValidator,
  verifyIndexedAttestation,
} from "../../stateTransition/util";


/**
 * Process ``AttesterSlashing`` operation.
 * Note that this function mutates ``state``.
 */
export function processAttesterSlashing(state: BeaconState, attesterSlashing: AttesterSlashing): void {
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;
  // Check that the attestations are conflicting
  assert(!serialize(attestation1.data, AttestationData).equals(serialize(attestation2.data, AttestationData)));
  assert(isDoubleVote(attestation1.data, attestation2.data) ||
    isSurroundVote(attestation1.data, attestation2.data));

  assert(verifyIndexedAttestation(state, attestation1));
  assert(verifyIndexedAttestation(state, attestation2));
  const attestingIndices1 = attestation1.custodyBit0Indices.concat(attestation1.custodyBit1Indices);
  const attestingIndices2 = attestation2.custodyBit0Indices.concat(attestation2.custodyBit1Indices);

  const currentEpoch = getCurrentEpoch(state);
  const slashableIndices = attestingIndices1
    .filter((index) => (
      attestingIndices2.includes(index) &&
      isSlashableValidator(state.validatorRegistry[index], currentEpoch)
    ));

  assert(slashableIndices.length >= 1);
  slashableIndices.forEach((index) =>
    slashValidator(state, index));
}
 
export default function processAttesterSlashings(state: BeaconState, block: BeaconBlock): void {
  assert(block.body.attesterSlashings.length <= MAX_ATTESTER_SLASHINGS);
  for (const attesterSlashing of block.body.attesterSlashings) {
    processAttesterSlashing(state, attesterSlashing);
  }
}
