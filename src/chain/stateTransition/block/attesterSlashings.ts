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

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#attester-slashings

/**
 * Process ``AttesterSlashing`` operation.
 */
export default function processAttesterSlashing(
  state: BeaconState,
  attesterSlashing: AttesterSlashing
): void {
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
  attestingIndices1
    // intersection w attestingIndices2
    .filter((i) => attestingIndices2.indexOf(i) !== -1)
    .forEach((index) => {
      if (isSlashableValidator(state.validatorRegistry[index], currentEpoch)) {
        slashValidator(state, index);
        slashedAny = true;
      }
    });
  assert(slashedAny);
}
