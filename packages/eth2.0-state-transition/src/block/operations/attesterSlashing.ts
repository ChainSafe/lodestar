/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {
  BeaconState,
  AttesterSlashing,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  getCurrentEpoch,
  isSlashableValidator,
  isSlashableAttestationData,
  isValidIndexedAttestation,
  slashValidator,
} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#attester-slashings

/**
 * Process ``AttesterSlashing`` operation.
 */
export function processAttesterSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  attesterSlashing: AttesterSlashing,
  verifySignatures = true,
): void {
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;

  // Check that the attestations are conflicting
  assert(isSlashableAttestationData(config, attestation1.data, attestation2.data));
  assert(isValidIndexedAttestation(config, state, attestation1, verifySignatures));
  assert(isValidIndexedAttestation(config, state, attestation2, verifySignatures));

  let slashedAny = false;
  const attestingIndices1 = attestation1.custodyBit0Indices.concat(attestation1.custodyBit1Indices);
  const attestingIndices2 = attestation2.custodyBit0Indices.concat(attestation2.custodyBit1Indices);
  const currentEpoch = getCurrentEpoch(config, state);
  attestingIndices1
    // intersection w attestingIndices2
    .filter((i) => attestingIndices2.indexOf(i) !== -1)
    .forEach((index) => {
      if (isSlashableValidator(state.validators[index], currentEpoch)) {
        slashValidator(config, state, index);
        slashedAny = true;
      }
    });
  assert(slashedAny);
}
