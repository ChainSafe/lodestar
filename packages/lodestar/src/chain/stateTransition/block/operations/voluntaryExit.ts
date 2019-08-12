/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {signingRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";

import {
  BeaconState,
  VoluntaryExit,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";


import {
  DomainType,
  FAR_FUTURE_EPOCH,
} from "../../../../constants";
import {
  getCurrentEpoch,
  getDomain,
  isActiveValidator,
  initiateValidatorExit,
} from "../../util";


/**
 * Process ``VoluntaryExit`` operation.
 */
export function processVoluntaryExit(
  config: IBeaconConfig,
  state: BeaconState,
  exit: VoluntaryExit
): void {
  const validator = state.validators[exit.validatorIndex];
  const currentEpoch = getCurrentEpoch(config, state);
  // Verify the validator is active
  assert(isActiveValidator(validator, currentEpoch));
  // Verify the validator has not yet exited
  assert(validator.exitEpoch === FAR_FUTURE_EPOCH);
  // Exits must specify an epoch when they become valid; they are not valid before then
  assert(currentEpoch >= exit.epoch);
  // Verify the validator has been active long enough
  assert(currentEpoch >= validator.activationEpoch + config.params.PERSISTENT_COMMITTEE_PERIOD);
  // Verify signature
  assert(bls.verify(
    validator.pubkey,
    signingRoot(exit, config.types.VoluntaryExit),
    exit.signature,
    getDomain(config, state, DomainType.VOLUNTARY_EXIT, exit.epoch),
  ));
  // Initiate exit
  initiateValidatorExit(config, state, exit.validatorIndex);
}
