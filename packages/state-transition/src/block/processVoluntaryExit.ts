import {FAR_FUTURE_EPOCH, ForkSeq} from "@lodestar/params";
import {phase0} from "@lodestar/types";
import {verifyVoluntaryExitSignature} from "../signatureSets/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {
  convertValidatorIndexToBuilderIndex,
  getPendingBalanceToWithdrawForBuilder,
  initiateBuilderExit,
  isActiveBuilder,
  isBuilderIndex,
} from "../util/gloas.js";
import {getPendingBalanceToWithdraw, isActiveValidator, isGloasCachedStateType} from "../util/index.js";
import {initiateValidatorExit} from "./index.js";

export enum VoluntaryExitValidity {
  valid = "valid",
  inactive = "inactive",
  alreadyExited = "already_exited",
  earlyEpoch = "early_epoch",
  shortTimeActive = "short_time_active",
  pendingWithdrawals = "pending_withdrawals",
  invalidSignature = "invalid_signature",
}

/**
 * Process a VoluntaryExit operation. Initiates the exit of a validator or builder.
 *
 * PERF: Work depends on number of VoluntaryExit per block. On regular networks the average is 0 / block.
 */
export function processVoluntaryExit(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  const voluntaryExit = signedVoluntaryExit.message;

  const validity = getVoluntaryExitValidity(fork, state, signedVoluntaryExit, verifySignature);
  if (validity !== VoluntaryExitValidity.valid) {
    throw Error(`Invalid voluntary exit at forkSeq=${fork} reason=${validity}`);
  }

  if (isGloasCachedStateType(state) && isBuilderIndex(voluntaryExit.validatorIndex)) {
    initiateBuilderExit(state, convertValidatorIndexToBuilderIndex(voluntaryExit.validatorIndex));
    return;
  }

  const validator = state.validators.get(signedVoluntaryExit.message.validatorIndex);
  initiateValidatorExit(fork, state, validator);
}

export function getVoluntaryExitValidity(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): VoluntaryExitValidity {
  const currentEpoch = state.epochCtx.epoch;
  const voluntaryExit = signedVoluntaryExit.message;

  // Exits must specify an epoch when they become valid; they are not valid before then
  if (currentEpoch < voluntaryExit.epoch) {
    return VoluntaryExitValidity.earlyEpoch;
  }

  // Check if this is a builder exit
  if (isGloasCachedStateType(state) && isBuilderIndex(voluntaryExit.validatorIndex)) {
    return getBuilderVoluntaryExitValidity(state, signedVoluntaryExit, verifySignature);
  }

  return getValidatorVoluntaryExitValidity(fork, state, signedVoluntaryExit, verifySignature);
}

function getBuilderVoluntaryExitValidity(
  state: CachedBeaconStateGloas,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature: boolean
): VoluntaryExitValidity {
  const {config, epochCtx} = state;
  const builderIndex = convertValidatorIndexToBuilderIndex(signedVoluntaryExit.message.validatorIndex);
  const builder = state.builders.getReadonly(builderIndex);

  // Verify the builder is active
  if (!isActiveBuilder(builder, state.finalizedCheckpoint.epoch)) {
    return builder.withdrawableEpoch !== FAR_FUTURE_EPOCH
      ? VoluntaryExitValidity.alreadyExited
      : VoluntaryExitValidity.inactive;
  }

  // Only exit builder if it has no pending withdrawals in the queue
  if (getPendingBalanceToWithdrawForBuilder(state, builderIndex) !== 0) {
    return VoluntaryExitValidity.pendingWithdrawals;
  }

  // Verify signature
  if (verifySignature && !verifyVoluntaryExitSignature(config, epochCtx.pubkeyCache, state, signedVoluntaryExit)) {
    return VoluntaryExitValidity.invalidSignature;
  }

  return VoluntaryExitValidity.valid;
}

function getValidatorVoluntaryExitValidity(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature: boolean
): VoluntaryExitValidity {
  const {config, epochCtx} = state;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = state.validators.getReadonly(voluntaryExit.validatorIndex);
  const currentEpoch = epochCtx.epoch;

  // verify the validator is active
  if (!isActiveValidator(validator, currentEpoch)) {
    return VoluntaryExitValidity.inactive;
  }

  // verify exit has not been initiated
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return VoluntaryExitValidity.alreadyExited;
  }

  // verify the validator had been active long enough
  if (currentEpoch < validator.activationEpoch + config.SHARD_COMMITTEE_PERIOD) {
    return VoluntaryExitValidity.shortTimeActive;
  }

  // only exit validator if it has no pending withdrawals in the queue
  if (
    fork >= ForkSeq.electra &&
    getPendingBalanceToWithdraw(state as CachedBeaconStateElectra, voluntaryExit.validatorIndex) !== 0
  ) {
    return VoluntaryExitValidity.pendingWithdrawals;
  }

  // Verify signature
  if (verifySignature && !verifyVoluntaryExitSignature(config, epochCtx.pubkeyCache, state, signedVoluntaryExit)) {
    return VoluntaryExitValidity.invalidSignature;
  }

  return VoluntaryExitValidity.valid;
}

export function isValidVoluntaryExit(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): boolean {
  return getVoluntaryExitValidity(fork, state, signedVoluntaryExit, verifySignature) === VoluntaryExitValidity.valid;
}
