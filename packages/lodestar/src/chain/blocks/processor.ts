import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IBlockJob} from "../interface";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IBeaconClock} from "../clock";
import {IStateRegenerator} from "../regen";
import {JobQueue} from "../../util/queue";

import {processBlock} from "./process";
import {validateBlock} from "./validate";

type BlockProcessorModules = {
  config: IBeaconConfig;
  forkChoice: IForkChoice;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  clock: IBeaconClock;
};

/**
 * BlockProcessor processes block jobs in a queued fashion, one after the other.
 */
export class BlockProcessor {
  private modules: BlockProcessorModules;
  private jobQueue: JobQueue;

  constructor({
    signal,
    queueSize = 256,
    ...modules
  }: BlockProcessorModules & {
    signal: AbortSignal;
    queueSize?: number;
  }) {
    this.modules = modules;
    this.jobQueue = new JobQueue({queueSize, signal});
  }

  public async processBlockJob(job: IBlockJob): Promise<void> {
    return this.jobQueue.enqueueJob(async () => await processBlockJob(this.modules, job));
  }
}

/**
 * Validate and process a block
 *
 * The only effects of running this are:
 * - forkChoice update, in the case of a valid block
 * - various events emitted: checkpoint, forkChoice:*, head, block, error:block
 * - (state cache update, from state regeneration)
 *
 * All other effects are provided by downstream event handlers
 */
export async function processBlockJob(modules: BlockProcessorModules, job: IBlockJob): Promise<void> {
  try {
    // First convert incoming blocks to TreeBacked backing (for efficiency reasons)
    // The root is computed multiple times, the contents are hash-tree-rooted multiple times,
    // and some of the contents end up in the state as tree-form.
    job.signedBlock = modules.config.types.SignedBeaconBlock.tree.createValue(job.signedBlock);
    await validateBlock({...modules, job});
    await processBlock({...modules, job});
  } catch (e) {
    // above functions only throw BlockError
    modules.emitter.emit(ChainEvent.errorBlock, e);
  }
}
