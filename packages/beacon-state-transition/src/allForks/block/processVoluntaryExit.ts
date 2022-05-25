import {FAR_FUTURE_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {isActiveValidator} from "../../util/index.js";
import {CachedBeaconStateAllForks} from "../../types.js";
import {initiateValidatorExit} from "../../allForks/block/index.js";
import {verifyVoluntaryExitSignature} from "../../allForks/signatureSets/index.js";

/**
 * Process a VoluntaryExit operation. Initiates the exit of a validator.
 *
 * PERF: Work depends on number of VoluntaryExit per block. On regular networks the average is 0 / block.
 */
export function processVoluntaryExitAllForks(
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  if (!isValidVoluntaryExit(state, signedVoluntaryExit, verifySignature)) {
    throw Error("Invalid voluntary exit");
  }

  const validator = state.validators.get(signedVoluntaryExit.message.validatorIndex);
  initiateValidatorExit(state, validator);
}

export function isValidVoluntaryExit(
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): boolean {
  const {config, epochCtx} = state;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = state.validators.get(voluntaryExit.validatorIndex);
  const currentEpoch = epochCtx.currentShuffling.epoch;

  return (
    // verify the validator is active
    isActiveValidator(validator, currentEpoch) &&
    // verify exit has not been initiated
    validator.exitEpoch === FAR_FUTURE_EPOCH &&
    // exits must specify an epoch when they become valid; they are not valid before then
    currentEpoch >= voluntaryExit.epoch &&
    // verify the validator had been active long enough
    currentEpoch >= validator.activationEpoch + config.SHARD_COMMITTEE_PERIOD &&
    // verify signature
    (!verifySignature || verifyVoluntaryExitSignature(state, signedVoluntaryExit))
  );
}
