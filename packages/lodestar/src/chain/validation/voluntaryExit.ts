import {phase0, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "..";
import {VoluntaryExitError, VoluntaryExitErrorCode, GossipAction} from "../errors";
import {IBeaconDb} from "../../db";

export async function validateGossipVoluntaryExit(
  chain: IBeaconChain,
  db: IBeaconDb,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  if (await db.voluntaryExit.has(voluntaryExit.message.validatorIndex)) {
    throw new VoluntaryExitError(GossipAction.IGNORE, {
      code: VoluntaryExitErrorCode.ALREADY_EXISTS,
    });
  }

  // What state should the voluntaryExit validate against?
  //
  // The only condtion that is time sensitive and may require a non-head state is
  // -> Validator is active && validator has not initiated exit
  // The voluntaryExit.epoch must be in the past so using the head state may evaluate the
  // validator's status in the future, compared to using a state at epoch voluntaryExit.epoch
  // Unless there's a clear need to use a non-head state, will use the head state as its cheap.
  const state = chain.getHeadState();

  try {
    // verifySignature = false, verified in batch below
    allForks.assertValidVoluntaryExit(state, voluntaryExit, false);
  } catch (e) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSet = allForks.getVoluntaryExitSignatureSet(state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    throw new VoluntaryExitError(GossipAction.REJECT, {
      code: VoluntaryExitErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
