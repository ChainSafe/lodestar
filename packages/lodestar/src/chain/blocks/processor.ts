import {AbortSignal} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IBlockJob, IChainSegmentJob} from "../interface";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IBeaconClock} from "../clock";
import {IStateRegenerator} from "../regen";
import {JobQueue} from "../../util/queue";

import {processBlocks} from "./process";
import {validateBlocks} from "./validate";
import {IBeaconDb} from "../../db";

type BlockProcessorModules = {
  config: IBeaconConfig;
  forkChoice: IForkChoice;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  clock: IBeaconClock;
  db: IBeaconDb;
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

  public async processChainSegment(job: IChainSegmentJob): Promise<void> {
    return this.jobQueue.enqueueJob(async () => await processChainSegmentJob(this.modules, job));
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
    await validateBlocks({...modules, jobs: [job]});
    await processBlocks({...modules, jobs: [job]});
  } catch (e) {
    // above functions only throw BlockError
    modules.emitter.emit(ChainEvent.errorBlock, e);
  }
}

/**
 * Similar to processBlockJob but this process a chain segment
 */
export async function processChainSegmentJob(
  modules: BlockProcessorModules,
  chainSegmentJob: IChainSegmentJob
): Promise<void> {
  try {
    const blockJobs: IBlockJob[] = chainSegmentJob.signedBlocks.map((signedBlock) => ({
      signedBlock,
      ...chainSegmentJob,
    }));
    await validateBlocks({...modules, jobs: blockJobs});
    await processBlocks({...modules, jobs: blockJobs});
  } catch (e) {
    // above functions only throw BlockError
    modules.emitter.emit(ChainEvent.errorBlock, e);
  }
}
