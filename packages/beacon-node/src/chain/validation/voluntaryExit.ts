import {VoluntaryExitValidity, getVoluntaryExitSignatureSet} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";
import type {BeaconEngine} from "../beaconEngine/beaconEngine.js";
import {
  GossipAction,
  VoluntaryExitError,
  VoluntaryExitErrorCode,
  voluntaryExitValidityToErrorCode,
} from "../errors/index.js";
import {RegenCaller} from "../regen/index.js";

export async function validateApiVoluntaryExit(
  this: BeaconEngine,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  const prioritizeBls = true;
  return validateVoluntaryExit.call(this, voluntaryExit, prioritizeBls);
}

export async function validateGossipVoluntaryExit(
  this: BeaconEngine,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  return validateVoluntaryExit.call(this, voluntaryExit);
}

async function validateVoluntaryExit(
  this: BeaconEngine,
  voluntaryExit: phase0.SignedVoluntaryExit,
  prioritizeBls = false
): Promise<void> {
  // [IGNORE] The voluntary exit is the first valid voluntary exit received for the validator with index
  // signed_voluntary_exit.message.validator_index.
  if (this.opPool.hasSeenVoluntaryExit(voluntaryExit.message.validatorIndex)) {
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
  const state = await this.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipVoluntaryExit);

  // [REJECT] All of the conditions within process_voluntary_exit pass validation.
  // verifySignature = false, verified in batch below
  const validity = state.getVoluntaryExitValidity(voluntaryExit, false);
  if (validity !== VoluntaryExitValidity.valid) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: voluntaryExitValidityToErrorCode(validity),
    });
  }

  const signatureSet = getVoluntaryExitSignatureSet(this.config, state, voluntaryExit);
  if (!(await this.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
    });
  }
}
