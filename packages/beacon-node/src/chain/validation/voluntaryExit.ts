import {
  VoluntaryExitValidity,
  getVoluntaryExitSignatureSet,
  getVoluntaryExitValidity,
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

export async function validateApiVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  const prioritizeBls = true;
  // For API submissions, we validate signature and permanent conditions
  // Transient conditions will be checked by the opPool before broadcasting
  return validateVoluntaryExitForApi(chain, voluntaryExit, prioritizeBls);
}

export async function validateGossipVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  return validateVoluntaryExit(chain, voluntaryExit);
}

async function validateVoluntaryExitForApi(
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

  // Get current state for validation
  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipVoluntaryExit);

  // Validate signature - this is a permanent check
  const signatureSet = getVoluntaryExitSignatureSet(state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
    });
  }
}

/**
 * Full validation for gossip voluntary exits.
 * Checks all conditions including transient ones.
 */
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

  // Check all conditions here:
  // verifySignature = false, verified in batch below
  const validity = getVoluntaryExitValidity(chain.config.getForkSeq(state.slot), state, voluntaryExit, false);
  if (validity !== VoluntaryExitValidity.valid) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: voluntaryExitValidityToErrorCode(validity),
    });
  }

  const signatureSet = getVoluntaryExitSignatureSet(state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
    });
  }
}

export async function validateVoluntaryExitTransientConditions(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<boolean> {
  try {
    const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipVoluntaryExit);
    // Check all transient conditions (verifySignature = false since we already verified it)
    const validity = getVoluntaryExitValidity(chain.config.getForkSeq(state.slot), state, voluntaryExit, false);
    return validity === VoluntaryExitValidity.valid;
  } catch (_e) {
    return false;
  }
}
