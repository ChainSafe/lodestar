import {FAR_FUTURE_EPOCH} from "@chainsafe/lodestar-params";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {isActiveValidator} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {initiateValidatorExit} from "../../allForks/block";
import {verifyVoluntaryExitSignature} from "../../allForks/signatureSets";
import {BlockProcess} from "../../util/blockProcess";

/**
 * Process a VoluntaryExit operation. Initiates the exit of a validator.
 *
 * PERF: Work depends on number of VoluntaryExit per block. On regular networks the average is 0 / block.
 */
export function processVoluntaryExitAllForks(
  state: CachedBeaconState<allForks.BeaconState>,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  blockProcess: BlockProcess,
  verifySignature = true
): void {
  assertValidVoluntaryExit(state as CachedBeaconState<allForks.BeaconState>, signedVoluntaryExit, verifySignature);
  const validator = state.validators[signedVoluntaryExit.message.validatorIndex];
  initiateValidatorExit(state as CachedBeaconState<allForks.BeaconState>, validator);
}

export function assertValidVoluntaryExit(
  state: CachedBeaconState<allForks.BeaconState>,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  const {config, epochCtx} = state;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = state.validators[voluntaryExit.validatorIndex];
  const currentEpoch = epochCtx.currentShuffling.epoch;
  // verify the validator is active
  if (!isActiveValidator(validator, currentEpoch)) {
    throw new Error("VoluntaryExit validator is not active");
  }
  // verify exit has not been initiated
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    throw new Error(`VoluntaryExit validator exit has already been initiated: exitEpoch=${validator.exitEpoch}`);
  }
  // exits must specify an epoch when they become valid; they are not valid before then
  if (!(currentEpoch >= voluntaryExit.epoch)) {
    throw new Error(`VoluntaryExit epoch is not yet valid: epoch=${voluntaryExit.epoch} currentEpoch=${currentEpoch}`);
  }
  // verify the validator had been active long enough
  if (!(currentEpoch >= validator.activationEpoch + config.SHARD_COMMITTEE_PERIOD)) {
    throw new Error("VoluntaryExit validator has not been active for long enough");
  }

  // verify signature
  if (verifySignature) {
    if (!verifyVoluntaryExitSignature(state as CachedBeaconState<allForks.BeaconState>, signedVoluntaryExit)) {
      throw new Error("VoluntaryExit has an invalid signature");
    }
  }
}
