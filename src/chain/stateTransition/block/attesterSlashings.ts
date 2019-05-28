/**
 * @module chain/stateTransition/block
 */

import assert from "assert";


import {
  BeaconBlock,
  BeaconState,
  AttesterSlashing,
} from "../../../types";

import {
  MAX_ATTESTER_SLASHINGS,
} from "../../../constants";

import {
  getCurrentEpoch,
  isSlashableValidator,
  isSlashableAttestationData,
  slashValidator,
  verifyIndexedAttestation,
} from "../../stateTransition/util";


/**
 * Process ``AttesterSlashing`` operation.
 * Note that this function mutates ``state``.
 */
export function processAttesterSlashing(state: BeaconState
  , attesterSlashing: AttesterSlashing): void {
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;
  // Check that the attestations are conflicting
  assert(isSlashableAttestationData(attestation1.data, attestation2.data));
  assert(verifyIndexedAttestation(state, attestation1));
  assert(verifyIndexedAttestation(state, attestation2));
  let slashedAny = false;
  const attestingIndices1 = attestation1.custodyBit0Indices.concat(attestation1.custodyBit1Indices);
  const attestingIndices2 = attestation2.custodyBit0Indices.concat(attestation2.custodyBit1Indices);
  const currentEpoch = getCurrentEpoch(state);
  attestingIndices1.forEach((index) => {
    if (
      attestingIndices2.includes(index) &&
      isSlashableValidator(state.validatorRegistry[index], currentEpoch)
    ) {
      slashValidator(state, index);
      slashedAny = true;
    }
  });
  assert(slashedAny);
}

export default function processAttesterSlashings(state: BeaconState, block: BeaconBlock): void {
  assert(block.body.attesterSlashings.length <= MAX_ATTESTER_SLASHINGS);
  for (const attesterSlashing of block.body.attesterSlashings) {
    processAttesterSlashing(state, attesterSlashing);
  }
}
