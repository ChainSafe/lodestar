import {isValidVoluntaryExit} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "..";
import {VoluntaryExitError, VoluntaryExitErrorCode} from "../errors/voluntaryExitError";
import {IBeaconDb} from "../../db";

export async function validateGossipVoluntaryExit(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  voluntaryExit: SignedVoluntaryExit
): Promise<void> {
  if (await db.voluntaryExit.has(voluntaryExit.message.validatorIndex)) {
    throw new VoluntaryExitError({
      code: VoluntaryExitErrorCode.ERR_EXIT_ALREADY_EXISTS,
    });
  }
  const {state} = await chain.regen.getCheckpointState({
    root: chain.forkChoice.getHeadRoot(),
    epoch: voluntaryExit.message.epoch,
  });
  if (!isValidVoluntaryExit(config, state, voluntaryExit)) {
    throw new VoluntaryExitError({
      code: VoluntaryExitErrorCode.ERR_INVALID_EXIT,
    });
  }
}
