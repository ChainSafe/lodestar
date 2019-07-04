/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {signingRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls-js";

import {
  BeaconState,
  VoluntaryExit,
} from "../../../../../types";

import {
  Domain,
  FAR_FUTURE_EPOCH,
  PERSISTENT_COMMITTEE_PERIOD,
} from "../../../../../../eth2-types/src/constants";


import {
  getCurrentEpoch,
  getDomain,
  isActiveValidator,
  initiateValidatorExit,
} from "../../util";


/**
 * Process ``VoluntaryExit`` operation.
 */
export function processVoluntaryExit(state: BeaconState, exit: VoluntaryExit): void {
  const validator = state.validatorRegistry[exit.validatorIndex];
  const currentEpoch = getCurrentEpoch(state);
  // Verify the validator is active
  assert(isActiveValidator(validator, currentEpoch));
  // Verify the validator has not yet exited
  assert(validator.exitEpoch === FAR_FUTURE_EPOCH);
  // Exits must specify an epoch when they become valid; they are not valid before then
  assert(currentEpoch >= exit.epoch);
  // Verify the validator has been active long enough
  assert(currentEpoch - validator.activationEpoch >= PERSISTENT_COMMITTEE_PERIOD);
  // Verify signature
  assert(bls.verify(
    validator.pubkey,
    signingRoot(exit, VoluntaryExit),
    exit.signature,
    getDomain(state, Domain.VOLUNTARY_EXIT, exit.epoch),
  ));
  // Initiate exit
  initiateValidatorExit(state, exit.validatorIndex);
}
