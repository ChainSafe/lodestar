/**
 * @module chain/stateTransition/block
 */

import {
  BeaconState,
  AttesterSlashing,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {
  getCurrentEpoch,
  isSlashableValidator,
  slashValidator,
  isValidAttesterSlashing,
} from "../../util";

/**
 * Process ``AttesterSlashing`` operation.
 */
export function processAttesterSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  attesterSlashing: AttesterSlashing,
  verifySignatures = true,
): void {
  // Check that the attestations are conflicting
  assert(isValidAttesterSlashing(config, state, attesterSlashing, verifySignatures));

  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;
  let slashedAny = false;
  const attestingIndices1 = Array.from(attestation1.attestingIndices);
  const attestingIndices2 = Array.from(attestation2.attestingIndices);
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
