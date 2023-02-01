import {phase0} from "@lodestar/types";
import {isValidVoluntaryExit, getVoluntaryExitSignatureSet} from "@lodestar/state-transition";
import {IBeaconChain} from "..";
import {VoluntaryExitError, VoluntaryExitErrorCode, GossipAction} from "../errors/index.js";

export async function validateGossipVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
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
  const state = await chain.getHeadStateAtCurrentEpoch();

  // [REJECT] All of the conditions within process_voluntary_exit pass validation.
  // verifySignature = false, verified in batch below
  if (!isValidVoluntaryExit(state, voluntaryExit, false)) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID,
    });
  }

  const signatureSet = getVoluntaryExitSignatureSet(state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
    });
  }
}
