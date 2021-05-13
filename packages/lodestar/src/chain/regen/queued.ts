import {AbortSignal} from "abort-controller";
import {Root, phase0, Slot, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {CachedBeaconState, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {CheckpointStateCache, StateContextCache} from "../stateCache";
import {ChainEventEmitter} from "../emitter";
import {IMetrics} from "../../metrics";
import {IBeaconDb} from "../../db";
import {JobQueue} from "../../util/queue";
import {IStateRegenerator} from "./interface";
import {StateRegenerator} from "./regen";
import {RegenError, RegenErrorCode} from "./errors";

const REGEN_QUEUE_MAX_LEN = 256;

type QueuedStateRegeneratorModules = {
  config: IBeaconConfig;
  emitter: ChainEventEmitter;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  db: IBeaconDb;
  metrics: IMetrics | null;
  signal: AbortSignal;
};

/**
 * Regenerates states that have already been processed by the fork choice
 *
 * All requests are queued so that only a single state at a time may be regenerated at a time
 */
export class QueuedStateRegenerator implements IStateRegenerator {
  private regen: StateRegenerator;
  private jobQueue: JobQueue;

  private config: IBeaconConfig;
  private forkChoice: IForkChoice;
  private stateCache: StateContextCache;
  private checkpointStateCache: CheckpointStateCache;

  constructor(modules: QueuedStateRegeneratorModules) {
    this.regen = new StateRegenerator(modules);
    this.jobQueue = new JobQueue(
      {maxLength: REGEN_QUEUE_MAX_LEN, signal: modules.signal},
      modules.metrics ? modules.metrics.regenQueue : undefined
    );
    this.config = modules.config;
    this.forkChoice = modules.forkChoice;
    this.stateCache = modules.stateCache;
    this.checkpointStateCache = modules.checkpointStateCache;
  }

  async getPreState(block: allForks.BeaconBlock): Promise<CachedBeaconState<allForks.BeaconState>> {
    // First attempt to fetch the state from caches before queueing
    const parentBlock = this.forkChoice.getBlock(block.parentRoot);
    if (!parentBlock) {
      throw new RegenError({
        code: RegenErrorCode.BLOCK_NOT_IN_FORKCHOICE,
        blockRoot: block.parentRoot,
      });
    }

    const parentEpoch = computeEpochAtSlot(this.config, parentBlock.slot);
    const blockEpoch = computeEpochAtSlot(this.config, block.slot);

    // Check the checkpoint cache (if the pre-state is a checkpoint state)
    if (parentEpoch < blockEpoch) {
      const checkpointState = this.checkpointStateCache.getLatest({root: block.parentRoot, epoch: blockEpoch});
      if (checkpointState) {
        return checkpointState;
      }
    }
    // Check the state cache
    const state = this.stateCache.get(parentBlock.stateRoot);
    if (state) {
      return state;
    }

    // The state is not immediately available in the caches, enqueue the job
    return await this.jobQueue.push(async () => await this.regen.getPreState(block));
  }

  async getCheckpointState(cp: phase0.Checkpoint): Promise<CachedBeaconState<allForks.BeaconState>> {
    // First attempt to fetch the state from cache before queueing
    const checkpointState = this.checkpointStateCache.get(cp);
    if (checkpointState) {
      return checkpointState;
    }
    // The state is not immediately available in the cache, enqueue the job
    return await this.jobQueue.push(async () => await this.regen.getCheckpointState(cp));
  }

  async getBlockSlotState(blockRoot: Root, slot: Slot): Promise<CachedBeaconState<allForks.BeaconState>> {
    return await this.jobQueue.push(async () => await this.regen.getBlockSlotState(blockRoot, slot));
  }

  async getState(stateRoot: Root): Promise<CachedBeaconState<allForks.BeaconState>> {
    // First attempt to fetch the state from cache before queueing
    const state = this.stateCache.get(stateRoot);
    if (state) {
      return state;
    }
    // The state is not immediately available in the cache, enqueue the job
    return await this.jobQueue.push(async () => await this.regen.getState(stateRoot));
  }
}
