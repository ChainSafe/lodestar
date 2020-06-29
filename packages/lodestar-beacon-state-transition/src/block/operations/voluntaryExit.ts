/**
 * @module chain/stateTransition/block
 */

import {BeaconState, SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";


import {initiateValidatorExit, isValidVoluntaryExit,} from "../../util";


/**
 * Process ``VoluntaryExit`` operation.
 */
export function processVoluntaryExit(
  config: IBeaconConfig,
  state: BeaconState,
  signedExit: SignedVoluntaryExit,
  verifySignature = true
): void {
  assert(isValidVoluntaryExit(config, state, signedExit, verifySignature));
  // Initiate exit
  initiateValidatorExit(config, state, signedExit.message.validatorIndex);
}
