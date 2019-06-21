/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {
  BeaconState,
  AttesterSlashing,
} from "../../../types";

import {
  getCurrentEpoch,
  isSlashableValidator,
  isSlashableAttestationData,
  slashValidator,
  validateIndexedAttestation,
} from "../util";


/**
 * Process ``AttesterSlashing`` operation.
 * Note that this function mutates ``state``.
 */

// SPEC 0.7
// def process_attester_slashing(state: BeaconState, attester_slashing: AttesterSlashing) -> None:
//   """
// Process ``AttesterSlashing`` operation.
// """
// attestation_1 = attester_slashing.attestation_1
// attestation_2 = attester_slashing.attestation_2
// assert is_slashable_attestation_data(attestation_1.data, attestation_2.data)
// validate_indexed_attestation(state, attestation_1)
// validate_indexed_attestation(state, attestation_2)
//
// slashed_any = False
// attesting_indices_1 = attestation_1.custody_bit_0_indices + attestation_1.custody_bit_1_indices
// attesting_indices_2 = attestation_2.custody_bit_0_indices + attestation_2.custody_bit_1_indices
// for index in sorted(set(attesting_indices_1).intersection(attesting_indices_2)):
// if is_slashable_validator(state.validator_registry[index], get_current_epoch(state)):
// slash_validator(state, index)
// slashed_any = True
// assert slashed_any

export default function processAttesterSlashing(state: BeaconState
  , attesterSlashing: AttesterSlashing): void {

  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;

  // Check that the attestations are conflicting
  assert(isSlashableAttestationData(attestation1.data, attestation2.data));
  validateIndexedAttestation(state, attestation1);
  validateIndexedAttestation(state, attestation2);

  let slashedAny = false;
  const attestingIndices1 = attestation1.custodyBit0Indices.concat(attestation1.custodyBit1Indices);
  const attestingIndices2 = attestation2.custodyBit0Indices.concat(attestation2.custodyBit1Indices);
  const currentEpoch = getCurrentEpoch(state);
  const indices = Array.from(new Set(attestingIndices1.filter((i) => {
    return attestingIndices2.indexOf(i) > -1;
  }))).sort((a, b) => a - b);
  indices.forEach((index) => {
    if (isSlashableValidator(state.validatorRegistry[index], currentEpoch)) {
      slashValidator(state, index);
      slashedAny = true;
    }
  });
  assert(slashedAny);
}
