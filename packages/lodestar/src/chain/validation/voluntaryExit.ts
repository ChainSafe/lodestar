import {phase0, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "..";
import {PeerAction} from "../../network";
import {VoluntaryExitError, VoluntaryExitErrorCode, GossipAction} from "../errors";

export async function validateGossipVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  // [IGNORE] The voluntary exit is the first valid voluntary exit received for the validator with index
  // signed_voluntary_exit.message.validator_index.
  if (chain.opPool.hasSeenVoluntaryExit(voluntaryExit.message.validatorIndex)) {
    throw new VoluntaryExitError(GossipAction.IGNORE, null, {
      code: VoluntaryExitErrorCode.ALREADY_EXISTS,
    });
  }

  // What state should the voluntaryExit validate against?
  //
  // The only condtion that is time sensitive and may require a non-head state is
  // -> Validator is active && validator has not initiated exit
  // The voluntaryExit.epoch must be in the past but the validator's status may change in recent epochs.
  // We dial the head state to the current epoch to get the current status of the validator. This is
  // relevant on periods of many skipped slots.
  const state = await chain.getHeadStateAtCurrentEpoch();

  // [REJECT] All of the conditions within process_voluntary_exit pass validation.
  // verifySignature = false, verified in batch below
  // These errors occur due to a fault in the beacon chain. It is not necessarily
  // the fault on the peer.
  if (!allForks.isValidVoluntaryExit(state, voluntaryExit, false)) {
    throw new VoluntaryExitError(GossipAction.REJECT, PeerAction.HighToleranceError, {
      code: VoluntaryExitErrorCode.INVALID,
    });
  }

  const signatureSet = allForks.getVoluntaryExitSignatureSet(state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, PeerAction.HighToleranceError, {
      code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
    });
  }
}
