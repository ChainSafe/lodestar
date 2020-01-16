/**
 * @module chain/stateTransition/block
 */

import assert from "assert";

import {BeaconState, VoluntaryExit,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";


import {initiateValidatorExit, isValidVoluntaryExit,} from "../../util";


/**
 * Process ``VoluntaryExit`` operation.
 */
export function processVoluntaryExit(
  config: IBeaconConfig,
  state: BeaconState,
  exit: VoluntaryExit,
  verifySignature = true
): void {
  assert(isValidVoluntaryExit(config, state, exit, verifySignature));
  // Initiate exit
  initiateValidatorExit(config, state, exit.validatorIndex);
}
