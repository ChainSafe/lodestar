/**
 * @module chain/stateTransition/block
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {initiateValidatorExit, isValidVoluntaryExit} from "../../../../util";

/**
 * Process ``VoluntaryExit`` operation.
 */
export function processVoluntaryExit(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  signedExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  assert.true(isValidVoluntaryExit(config, state, signedExit, verifySignature), "Invalid voluntary exit");
  // Initiate exit
  initiateValidatorExit(config, state, signedExit.message.validatorIndex);
}
