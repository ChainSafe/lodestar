import {AbortSignal} from "@chainsafe/abort-controller";
import {Root, phase0, Slot, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {CachedBeaconState, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {CheckpointStateCache, StateContextCache} from "../stateCache";
import {ChainEventEmitter} from "../emitter";
import {IMetrics} from "../../metrics";
import {IBeaconDb} from "../../db";
import {JobItemQueue} from "../../util/queue";
import {IStateRegenerator,IRegenCaller} from "./interface";
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

type RegenRequestKey = keyof IStateRegenerator;
type RegenRequestByKey = {[K in RegenRequestKey]: {key: K; args: Parameters<IStateRegenerator[K]>}};
export type RegenRequest = RegenRequestByKey[RegenRequestKey];

/**
 * Regenerates states that have already been processed by the fork choice
 *
 * All requests are queued so that only a single state at a time may be regenerated at a time
 */
export class QueuedStateRegenerator implements IStateRegenerator {
  readonly jobQueue: JobItemQueue<[RegenRequest], CachedBeaconState<allForks.BeaconState>>;
  private regen: StateRegenerator;

  private forkChoice: IForkChoice;
  private stateCache: StateContextCache;
  private checkpointStateCache: CheckpointStateCache;

  constructor(modules: QueuedStateRegeneratorModules) {
    this.regen = new StateRegenerator(modules);
    this.jobQueue = new JobItemQueue<[RegenRequest], CachedBeaconState<allForks.BeaconState>>(
      this.jobQueueProcessor,
      {maxLength: REGEN_QUEUE_MAX_LEN, signal: modules.signal},
      modules.metrics ? modules.metrics.regenQueue : undefined
    );
    this.forkChoice = modules.forkChoice;
    this.stateCache = modules.stateCache;
    this.checkpointStateCache = modules.checkpointStateCache;
  }

  async getPreState(
    block: allForks.BeaconBlock,
    rCaller?: IRegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
    // First attempt to fetch the state from caches before queueing
    const parentBlock = this.forkChoice.getBlock(block.parentRoot);
    if (!parentBlock) {
      throw new RegenError({
        code: RegenErrorCode.BLOCK_NOT_IN_FORKCHOICE,
        blockRoot: block.parentRoot,
      });
    }

    const parentEpoch = computeEpochAtSlot(parentBlock.slot);
    const blockEpoch = computeEpochAtSlot(block.slot);

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
    return this.jobQueue.push({key: "getPreState", args: [block, rCaller]});
  }

  async getCheckpointState(
    cp: phase0.Checkpoint,
    rCaller?: IRegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
    // First attempt to fetch the state from cache before queueing
    const checkpointState = this.checkpointStateCache.get(cp);
    if (checkpointState) {
      return checkpointState;
    }
    // The state is not immediately available in the cache, enqueue the job
    return this.jobQueue.push({key: "getCheckpointState", args: [cp,rCaller]});
  }

  async getBlockSlotState(blockRoot: Root, slot: Slot, rCaller?: IRegenCaller): Promise<CachedBeaconState<allForks.BeaconState>> {
    return this.jobQueue.push({key: "getBlockSlotState", args: [blockRoot, slot,rCaller]});
  }

  async getState(stateRoot: Root, rCaller?: IRegenCaller): Promise<CachedBeaconState<allForks.BeaconState>> {
    // First attempt to fetch the state from cache before queueing
    const state = this.stateCache.get(stateRoot);
    if (state) {
      return state;
    }
    // The state is not immediately available in the cache, enqueue the job
    return this.jobQueue.push({key: "getState", args: [stateRoot, rCaller]});
  }

  private jobQueueProcessor = async (regenRequest: RegenRequest): Promise<CachedBeaconState<allForks.BeaconState>> => {
    switch (regenRequest.key) {
      case "getPreState":
        return this.regen.getPreState(...regenRequest.args);
      case "getCheckpointState":
        return this.regen.getCheckpointState(...regenRequest.args);
      case "getBlockSlotState":
        return this.regen.getBlockSlotState(...regenRequest.args);
      case "getState":
        return this.regen.getState(...regenRequest.args);
    }
  };
}
