import {phase0, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "..";
import {VoluntaryExitError, VoluntaryExitErrorCode} from "../errors/voluntaryExitError";
import {IBeaconDb} from "../../db";

export async function validateGossipVoluntaryExit(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  if (await db.voluntaryExit.has(voluntaryExit.message.validatorIndex)) {
    throw new VoluntaryExitError({
      code: VoluntaryExitErrorCode.EXIT_ALREADY_EXISTS,
    });
  }

  const state = await chain.regen.getCheckpointState({
    root: chain.forkChoice.getHeadRoot(),
    epoch: voluntaryExit.message.epoch,
  });

  try {
    // verifySignature = false, verified in batch below
    phase0.assertValidVoluntaryExit(state, voluntaryExit, false);
  } catch (e) {
    throw new VoluntaryExitError({
      code: VoluntaryExitErrorCode.INVALID_EXIT,
      error: e as Error,
    });
  }

  const signatureSet = allForks.getVoluntaryExitSignatureSet(state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new VoluntaryExitError({
      code: VoluntaryExitErrorCode.INVALID_EXIT,
      error: Error("Invalid signature"),
    });
  }
}
