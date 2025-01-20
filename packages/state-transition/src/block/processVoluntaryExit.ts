import {FAR_FUTURE_EPOCH, ForkSeq} from "@lodestar/params";
import {phase0} from "@lodestar/types";
import {verifyVoluntaryExitSignature} from "../signatureSets/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra} from "../types.js";
import {getPendingBalanceToWithdraw, isActiveValidator} from "../util/index.js";
import {initiateValidatorExit} from "./index.js";

/**
 * Process a VoluntaryExit operation. Initiates the exit of a validator.
 *
 * PERF: Work depends on number of VoluntaryExit per block. On regular networks the average is 0 / block.
 */
export function processVoluntaryExit(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  const isValidExit =
    fork >= ForkSeq.electra
      ? isValidVoluntaryExitElectra(state as CachedBeaconStateElectra, signedVoluntaryExit, verifySignature)
      : isValidVoluntaryExit(state, signedVoluntaryExit, verifySignature);
  if (!isValidExit) {
    throw Error(`Invalid voluntary exit at forkSeq=${fork}`);
  }

  const validator = state.validators.get(signedVoluntaryExit.message.validatorIndex);
  initiateValidatorExit(fork, state, validator);
}

export function isValidVoluntaryExit(
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): boolean {
  const {config, epochCtx} = state;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = state.validators.get(voluntaryExit.validatorIndex);
  const currentEpoch = epochCtx.epoch;

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

function isValidVoluntaryExitElectra(
  state: CachedBeaconStateElectra,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): boolean {
  // only exit validator if it has no pending withdrawals in the queue (post-Electra only)
  if (getPendingBalanceToWithdraw(state, signedVoluntaryExit.message.validatorIndex) === 0) {
    return isValidVoluntaryExit(state, signedVoluntaryExit, verifySignature);
  }

  return false;
}
