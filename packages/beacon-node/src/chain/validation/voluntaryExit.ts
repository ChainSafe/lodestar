import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {
  IBeaconStateView,
  VoluntaryExitValidity,
  computeEpochAtSlot,
  getVoluntaryExitSignatureSet,
} from "@lodestar/state-transition";
import {ValidatorIndex, phase0} from "@lodestar/types";
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

  // What state should the voluntaryExit validate against?
  //
  // The only condition that is time sensitive and may require a non-head state is
  // -> Validator is active && validator has not initiated exit
  // The voluntaryExit.epoch must be in the past but the validator's status may change in recent epochs.
  // We dial the head state to the current epoch to get the current status of the validator. This is
  // relevant on periods of many skipped slots.
  const currentEpoch = computeEpochAtSlot(chain.clock.currentSlotWithGossipDisparity);

  // [IGNORE] The voluntary exit epoch is not in the future, allowing for MAXIMUM_GOSSIP_CLOCK_DISPARITY
  if (voluntaryExit.message.epoch > currentEpoch) {
    throw new VoluntaryExitError(GossipAction.IGNORE, {code: VoluntaryExitErrorCode.EARLY_EPOCH});
  }

  const state = await chain.getHeadStateAtEpoch(currentEpoch, RegenCaller.validateGossipVoluntaryExit);

  // verifySignature = false, verified in batch below
  const validity = state.getVoluntaryExitValidity(voluntaryExit, false);
  if (validity !== VoluntaryExitValidity.valid) {
    throw getGossipVoluntaryExitError(state, voluntaryExit.message.validatorIndex, validity);
  }

  // [REJECT] The signature is valid
  const signatureSet = getVoluntaryExitSignatureSet(chain.config, state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
    });
  }
}

function getGossipVoluntaryExitError(
  state: IBeaconStateView,
  validatorIndex: ValidatorIndex,
  validity: Exclude<VoluntaryExitValidity, VoluntaryExitValidity.valid>
): VoluntaryExitError {
  switch (validity) {
    case VoluntaryExitValidity.earlyEpoch:
    // [IGNORE] The validator has not already initiated exit
    case VoluntaryExitValidity.alreadyExited:
    // [IGNORE] The validator has no pending partial withdrawals
    case VoluntaryExitValidity.pendingWithdrawals:
      return new VoluntaryExitError(GossipAction.IGNORE, {code: voluntaryExitValidityToErrorCode(validity)});

    case VoluntaryExitValidity.inactive:
      // The spec checks for an initiated exit before checking that the validator is active
      if (validatorIndex < state.validatorCount && state.getValidator(validatorIndex).exitEpoch !== FAR_FUTURE_EPOCH) {
        return new VoluntaryExitError(GossipAction.IGNORE, {code: VoluntaryExitErrorCode.ALREADY_EXITED});
      }
      // [REJECT] The validator index is valid
      // [REJECT] The validator is active
      return new VoluntaryExitError(GossipAction.REJECT, {code: VoluntaryExitErrorCode.INACTIVE});

    // [REJECT] The validator has been active long enough
    case VoluntaryExitValidity.shortTimeActive:
    case VoluntaryExitValidity.invalidSignature:
      return new VoluntaryExitError(GossipAction.REJECT, {code: voluntaryExitValidityToErrorCode(validity)});
  }
}
