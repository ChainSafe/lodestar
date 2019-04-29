import assert from "assert";
import {signingRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  VoluntaryExit,
} from "../../../types";

import {
  Domain,
  MAX_VOLUNTARY_EXITS,
  FAR_FUTURE_EPOCH,
  PERSISTENT_COMMITTEE_PERIOD,
} from "../../../constants";

import {blsVerify} from "../../../stubs/bls";

import {
  getCurrentEpoch,
  getDomain,
  isActiveValidator,
  initiateValidatorExit,
} from "../util";


/**
 * Process ``VoluntaryExit`` operation.
 * Note that this function mutates ``state``.
 * @param {BeaconState} state
 * @param {VoluntaryExit} exit
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
  assert(blsVerify(
    validator.pubkey,
    signingRoot(exit, VoluntaryExit),
    exit.signature,
    getDomain(state, Domain.VOLUNTARY_EXIT, exit.epoch),
  ));
  // Initiate exit
  initiateValidatorExit(state, exit.validatorIndex);
}

export default function processVoluntaryExits(state: BeaconState, block: BeaconBlock): void {
  assert(block.body.voluntaryExits.length <= MAX_VOLUNTARY_EXITS);
  for (const exit of block.body.voluntaryExits) {
    processVoluntaryExit(state, exit);
  }
}
