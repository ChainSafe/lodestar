import {PublicKey, Signature, verify} from "@chainsafe/blst";
import {FAR_FUTURE_EPOCH, ForkSeq} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {verifyVoluntaryExitSignature} from "../signatureSets/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {
  convertValidatorIndexToBuilderIndex,
  getPendingBalanceToWithdrawForBuilder,
  initiateBuilderExit,
  isActiveBuilder,
  isBuilderIndex,
} from "../util/gloas.js";
import {computeSigningRoot, getCurrentEpoch, getPendingBalanceToWithdraw, isActiveValidator} from "../util/index.js";
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
  const currentEpoch = getCurrentEpoch(state);

  // Exits must specify an epoch when they become valid; they are not valid before then
  if (currentEpoch < voluntaryExit.epoch) {
    throw Error(`Voluntary exit epoch ${voluntaryExit.epoch} is after current epoch ${currentEpoch}`);
  }

  // Check if this is a builder exit
  if (fork >= ForkSeq.gloas && isBuilderIndex(voluntaryExit.validatorIndex)) {
    const stateGloas = state as CachedBeaconStateGloas;
    const builderIndex = convertValidatorIndexToBuilderIndex(voluntaryExit.validatorIndex);
    const builder = stateGloas.builders.getReadonly(builderIndex);

    // Verify the builder is active
    if (!isActiveBuilder(stateGloas, builderIndex)) {
      throw Error(`Builder ${builderIndex} is not active`);
    }

    // Only exit builder if it has no pending withdrawals in the queue
    if (getPendingBalanceToWithdrawForBuilder(stateGloas, builderIndex) !== 0) {
      throw Error(`Builder ${builderIndex} has pending withdrawals`);
    }

    // Verify signature
    if (verifySignature) {
      const domain = state.config.getDomainForVoluntaryExit(state.slot);
      const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);

      try {
        const publicKey = PublicKey.fromBytes(builder.pubkey);
        const signature = Signature.fromBytes(signedVoluntaryExit.signature, true);

        if (!verify(signingRoot, publicKey, signature)) {
          throw Error("BLS verify failed");
        }
      } catch (e) {
        throw Error(`Builder ${builderIndex} invalid exit signature reason=${(e as Error).message}`);
      }
    }

    // Initiate builder exit
    initiateBuilderExit(stateGloas, builderIndex);
    return;
  }

  // Handle validator exit
  const validity = getVoluntaryExitValidity(fork, state, signedVoluntaryExit, verifySignature);
  if (validity !== VoluntaryExitValidity.valid) {
    throw Error(`Invalid voluntary exit at forkSeq=${fork} reason=${validity}`);
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
  const {config, epochCtx} = state;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = state.validators.get(voluntaryExit.validatorIndex);
  const currentEpoch = epochCtx.epoch;

  // verify the validator is active
  if (!isActiveValidator(validator, currentEpoch)) {
    return VoluntaryExitValidity.inactive;
  }

  // verify exit has not been initiated
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return VoluntaryExitValidity.alreadyExited;
  }

  // exits must specify an epoch when they become valid; they are not valid before then
  if (currentEpoch < voluntaryExit.epoch) {
    return VoluntaryExitValidity.earlyEpoch;
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

  if (
    verifySignature &&
    !verifyVoluntaryExitSignature(state.config, epochCtx.index2pubkey, state.slot, signedVoluntaryExit)
  ) {
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
