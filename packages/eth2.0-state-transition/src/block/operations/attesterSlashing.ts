/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {
  BeaconState,
  AttesterSlashing,
  ValidatorIndex,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  getCurrentEpoch,
  isSlashableValidator,
  slashValidator,
  isValidAttesterSlashing,
} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.9.1/specs/core/0_beacon-chain.md#attester-slashings

/**
 * Process ``AttesterSlashing`` operation.
 */
export function processAttesterSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  attesterSlashing: AttesterSlashing
): void {
  // Check that the attestations are conflicting
  assert(isValidAttesterSlashing(config, state, attesterSlashing));

  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;
  let slashedAny = false;
  const attestingIndices1 = attestation1.attestingIndices;
  const attestingIndices2 = attestation2.attestingIndices;
  const intersectionIndices = attestingIndices1.filter((i) => attestingIndices2.indexOf(i) !== -1);
  const sortedIndices = intersectionIndices.sort((index1: ValidatorIndex, index2: ValidatorIndex) => index1 - index2);

  const currentEpoch = getCurrentEpoch(config, state);
  sortedIndices.forEach((index) => {
    if (isSlashableValidator(state.validators[index], currentEpoch)) {
      slashValidator(config, state, index);
      slashedAny = true;
    }
  });

  assert(slashedAny);
}
