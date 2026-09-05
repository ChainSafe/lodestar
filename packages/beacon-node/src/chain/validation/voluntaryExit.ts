import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {
  VoluntaryExitValidity,
  computeEpochAtSlot,
  getVoluntaryExitSignatureSet,
  isActiveValidator,
} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";
import {
  GossipAction,
  VoluntaryExitError,
  VoluntaryExitErrorCode,
  voluntaryExitValidityToErrorCode,
} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {RegenCaller} from "../regen/index.js";

export type ApiVoluntaryExitResult = {status: "published"} | {status: "deferred"; validity: VoluntaryExitValidity};

// Variants that can become valid in a future epoch without user action.
// - earlyEpoch: exit.message.epoch is in the future; valid once current epoch catches up
// - shortTimeActive: validator active < SHARD_COMMITTEE_PERIOD; valid once enough time passes
// - pendingWithdrawals: Electra; valid once pending partial withdrawals drain
// Note: VoluntaryExitValidity.inactive is intentionally excluded. It conflates
// "validator does not exist" (permanent) with "validator not yet activated"
// (transient), and cleanly classifying it requires splitting the enum variant
// upstream. Left for a future follow-up.

export function isTransientExitValidity(v: VoluntaryExitValidity): boolean {
  switch (v) {
    case VoluntaryExitValidity.earlyEpoch:
    case VoluntaryExitValidity.shortTimeActive:
    case VoluntaryExitValidity.pendingWithdrawals:
      return true;
    case VoluntaryExitValidity.valid:
    case VoluntaryExitValidity.inactive:
    case VoluntaryExitValidity.alreadyExited:
    case VoluntaryExitValidity.invalidSignature:
      return false;
  }
}

// Comments for each call are present inside `validateVoluntaryExit`.
export async function validateApiVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<ApiVoluntaryExitResult> {
  const prioritizeBls = true;

  if (
    chain.opPool.hasSeenVoluntaryExit(voluntaryExit.message.validatorIndex) ||
    chain.deferredVoluntaryExitPool.has(voluntaryExit.message.validatorIndex)
  ) {
    throw new VoluntaryExitError(GossipAction.IGNORE, {
      code: VoluntaryExitErrorCode.ALREADY_EXISTS,
    });
  }

  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateApiVoluntaryExit);
  const validity = state.getVoluntaryExitValidity(voluntaryExit, false);

  if (validity !== VoluntaryExitValidity.valid && !isTransientExitValidity(validity)) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: voluntaryExitValidityToErrorCode(validity),
    });
  }

  const signatureSet = getVoluntaryExitSignatureSet(chain.config, state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
    });
  }

  if (validity !== VoluntaryExitValidity.valid) {
    // Transient failure — signature is good, defer
    return {status: "deferred", validity};
  }

  return {status: "published"};
}

export async function validateGossipVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  return validateVoluntaryExit(chain, voluntaryExit);
}

async function validateVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit,
  prioritizeBls = false
): Promise<void> {
  // [IGNORE] The voluntary exit is the first valid voluntary exit received for the validator with index
  // signed_voluntary_exit.message.validator_index.
  if (chain.opPool.hasSeenVoluntaryExit(voluntaryExit.message.validatorIndex)) {
    throw new VoluntaryExitError(GossipAction.IGNORE, {
      code: VoluntaryExitErrorCode.ALREADY_EXISTS,
    });
  }

  if (voluntaryExit.message.epoch > computeEpochAtSlot(chain.clock.currentSlotWithGossipDisparity)) {
    throw new VoluntaryExitError(GossipAction.IGNORE, {code: VoluntaryExitErrorCode.EARLY_EPOCH});
  }

  const state = chain.getHeadState();
  if (voluntaryExit.message.validatorIndex >= state.validatorCount) {
    throw new VoluntaryExitError(GossipAction.REJECT, {code: VoluntaryExitErrorCode.INVALID_VALIDATOR_INDEX});
  }

  const validator = state.getValidator(voluntaryExit.message.validatorIndex);
  const currentEpoch = computeEpochAtSlot(state.slot);
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    throw new VoluntaryExitError(GossipAction.IGNORE, {code: VoluntaryExitErrorCode.ALREADY_EXITED});
  }
  if (!isActiveValidator(validator, currentEpoch)) {
    throw new VoluntaryExitError(GossipAction.REJECT, {code: VoluntaryExitErrorCode.INACTIVE});
  }
  if (currentEpoch < validator.activationEpoch + chain.config.SHARD_COMMITTEE_PERIOD) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.SHORT_TIME_ACTIVE,
    });
  }

  const signatureSet = getVoluntaryExitSignatureSet(chain.config, state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
    });
  }
}
