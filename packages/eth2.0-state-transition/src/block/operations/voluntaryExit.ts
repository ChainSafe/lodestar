/**
 * @module chain/stateTransition/block
 */

import assert from "assert";

import {BeaconState, SignedVoluntaryExit} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";


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
