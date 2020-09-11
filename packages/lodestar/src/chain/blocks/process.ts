import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BlockPool} from "./pool";
import {ChainEventEmitter} from "../emitter";
import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";
import {IBlockProcessJob} from "../interface";
import {runStateTransition} from "./stateTransition";
import {StateRegenerator} from "../regen";

export function processBlock(
  config: IBeaconConfig,
  logger: ILogger,
  db: IBeaconDb,
  forkChoice: ForkChoice,
  regen: StateRegenerator,
  pool: BlockPool,
  eventBus: ChainEventEmitter
): (
  source: AsyncIterable<IBlockProcessJob>
) => AsyncGenerator<{
  preStateContext: ITreeStateContext;
  block: SignedBeaconBlock;
  postStateContext: ITreeStateContext;
  finalized: boolean;
}> {
  return (source) => {
    return (async function* () {
      for await (const job of source) {
        const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
        let preStateContext;
        try {
          preStateContext = await regen.getPreState(job.signedBlock.message);
        } catch (e) {
          logger.verbose("No pre-state found, dropping block", e);
          continue;
        }
        // Run the state transition
        let postStateContext;
        try {
          postStateContext = await runStateTransition(eventBus, forkChoice, preStateContext, job);
        } catch (e) {
          logger.verbose("Failure to process block", {
            slot: job.signedBlock.message.slot,
            blockRoot: toHexString(blockRoot),
            parentRoot: toHexString(job.signedBlock.message.parentRoot),
          });
          e.job = job;
          eventBus.emit("error:block", e);
          continue;
        }
        // On successful transition, update system state
        if (job.reprocess) {
          await db.stateCache.add(postStateContext);
        } else {
          await Promise.all([db.stateCache.add(postStateContext), db.block.put(blockRoot, job.signedBlock)]);
        }

        pool.onProcessedBlock(job.signedBlock);
        yield {
          preStateContext,
          postStateContext: postStateContext,
          block: job.signedBlock,
          finalized: job.trusted,
        };
      }
    })();
  };
}
