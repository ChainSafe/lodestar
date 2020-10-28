import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter} from "../emitter";
import {IBlockJob} from "../interface";
import {runStateTransition} from "./stateTransition";
import {IStateRegenerator, RegenError} from "../regen";
import {BlockError, BlockErrorCode} from "../errors";
import {IBeaconDb} from "../../db";

export async function processBlock({
  forkChoice,
  regen,
  emitter,
  db,
  job,
}: {
  forkChoice: IForkChoice;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  db: IBeaconDb;
  job: IBlockJob;
}): Promise<void> {
  try {
    const preStateContext = await regen.getPreState(job.signedBlock.message);
    await runStateTransition(emitter, forkChoice, db, preStateContext, job);
  } catch (e) {
    if (e instanceof RegenError) {
      throw new BlockError({
        code: BlockErrorCode.ERR_PRESTATE_MISSING,
        job,
      });
    } else if (e instanceof BlockError) {
      throw e;
    } else {
      throw new BlockError({
        code: BlockErrorCode.ERR_BEACON_CHAIN_ERROR,
        error: e,
        job,
      });
    }
  }
}
