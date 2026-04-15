import {VoluntaryExitValidity, getVoluntaryExitSignatureSet, isTransientExitValidity} from "@lodestar/state-transition";
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

// Comments for each call are present inside `validateVoluntaryExit`.
export async function validateApiVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<ApiVoluntaryExitResult> {
  const prioritizeBls = true;

  if (chain.opPool.hasSeenVoluntaryExit(voluntaryExit.message.validatorIndex)) {
    throw new VoluntaryExitError(GossipAction.IGNORE, {
      code: VoluntaryExitErrorCode.ALREADY_EXISTS,
    });
  }

  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateApiVoluntaryExit);

  if (voluntaryExit.message.validatorIndex >= state.validatorCount) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INACTIVE,
    });
  }

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
  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipVoluntaryExit);

  // [REJECT] All of the conditions within process_voluntary_exit pass validation.
  // verifySignature = false, verified in batch below
  const validity = state.getVoluntaryExitValidity(voluntaryExit, false);
  if (validity !== VoluntaryExitValidity.valid) {
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
}
