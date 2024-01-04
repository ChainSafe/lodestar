import {toHexString} from "@chainsafe/ssz";
import {phase0, Slot, allForks, RootHex, Epoch} from "@lodestar/types";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {CheckpointHex, toCheckpointHex} from "../stateCache/index.js";
import {Metrics} from "../../metrics/index.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {BlockStateCache, CheckpointStateCache} from "../stateCache/types.js";
import {IStateRegenerator, IStateRegeneratorInternal, RegenCaller, RegenFnName, StateCloneOpts} from "./interface.js";
import {StateRegenerator, RegenModules} from "./regen.js";
import {RegenError, RegenErrorCode} from "./errors.js";

const REGEN_QUEUE_MAX_LEN = 256;
// TODO: Should this constant be lower than above? 256 feels high
const REGEN_CAN_ACCEPT_WORK_THRESHOLD = 16;

type QueuedStateRegeneratorModules = RegenModules & {
  signal: AbortSignal;
  logger: Logger;
};

type RegenRequestKey = keyof IStateRegeneratorInternal;
type RegenRequestByKey = {[K in RegenRequestKey]: {key: K; args: Parameters<IStateRegeneratorInternal[K]>}};
export type RegenRequest = RegenRequestByKey[RegenRequestKey];

/**
 * Regenerates states that have already been processed by the fork choice
 *
 * All requests are queued so that only a single state at a time may be regenerated at a time
 */
export class QueuedStateRegenerator implements IStateRegenerator {
  readonly jobQueue: JobItemQueue<[RegenRequest], CachedBeaconStateAllForks>;
  private readonly regen: StateRegenerator;

  private readonly forkChoice: IForkChoice;
  private readonly stateCache: BlockStateCache;
  private readonly checkpointStateCache: CheckpointStateCache;
  private readonly metrics: Metrics | null;
  private readonly logger: Logger;

  constructor(modules: QueuedStateRegeneratorModules) {
    this.regen = new StateRegenerator(modules);
    this.jobQueue = new JobItemQueue<[RegenRequest], CachedBeaconStateAllForks>(
      this.jobQueueProcessor,
      {maxLength: REGEN_QUEUE_MAX_LEN, signal: modules.signal},
      modules.metrics ? modules.metrics.regenQueue : undefined
    );
    this.forkChoice = modules.forkChoice;
    this.stateCache = modules.stateCache;
    this.checkpointStateCache = modules.checkpointStateCache;
    this.metrics = modules.metrics;
    this.logger = modules.logger;
  }

  async init(): Promise<void> {
    if (this.checkpointStateCache.init) {
      return this.checkpointStateCache.init();
    }
  }

  canAcceptWork(): boolean {
    return this.jobQueue.jobLen < REGEN_CAN_ACCEPT_WORK_THRESHOLD;
  }

  dropCache(): void {
    this.stateCache.clear();
    this.checkpointStateCache.clear();
  }

  dumpCacheSummary(): routes.lodestar.StateCacheItem[] {
    return [...this.stateCache.dumpSummary(), ...this.checkpointStateCache.dumpSummary()];
  }

  getStateSync(stateRoot: RootHex): CachedBeaconStateAllForks | null {
    return this.stateCache.get(stateRoot);
  }

  async getCheckpointStateOrBytes(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | Uint8Array | null> {
    return this.checkpointStateCache.getStateOrBytes(cp);
  }

  async onProcessState(blockRootHex: RootHex, state: CachedBeaconStateAllForks): Promise<number> {
    return this.checkpointStateCache.processState(blockRootHex, state);
  }

  getCheckpointStateSync(cp: CheckpointHex): CachedBeaconStateAllForks | null {
    return this.checkpointStateCache.get(cp);
  }

  getClosestHeadState(head: ProtoBlock): CachedBeaconStateAllForks | null {
    return this.checkpointStateCache.getLatest(head.blockRoot, Infinity) || this.stateCache.get(head.stateRoot);
  }

  pruneOnCheckpoint(finalizedEpoch: Epoch, justifiedEpoch: Epoch, headStateRoot: RootHex): void {
    this.checkpointStateCache.prune(finalizedEpoch, justifiedEpoch);
    this.stateCache.prune(headStateRoot);
  }

  pruneOnFinalized(finalizedEpoch: number): void {
    this.checkpointStateCache.pruneFinalized(finalizedEpoch);
    this.stateCache.deleteAllBeforeEpoch(finalizedEpoch);
  }

  addPostState(postState: CachedBeaconStateAllForks): void {
    this.stateCache.add(postState);
  }

  addCheckpointState(cp: phase0.Checkpoint, item: CachedBeaconStateAllForks): void {
    this.checkpointStateCache.add(cp, item);
  }

  updateHeadState(newHeadStateRoot: RootHex, maybeHeadState: CachedBeaconStateAllForks): void {
    const headState =
      newHeadStateRoot === toHexString(maybeHeadState.hashTreeRoot())
        ? maybeHeadState
        : this.stateCache.get(newHeadStateRoot);

    if (headState) {
      this.stateCache.setHeadState(headState);
    } else {
      // Trigger regen on head change if necessary
      this.logger.warn("Head state not available, triggering regen", {stateRoot: newHeadStateRoot});
      // it's important to reload state to regen head state here
      const shouldReload = true;
      // head has changed, so the existing cached head state is no longer useful. Set strong reference to null to free
      // up memory for regen step below. During regen, node won't be functional but eventually head will be available
      // for legacy StateContextCache only
      this.stateCache.setHeadState(null);
      this.regen.getState(newHeadStateRoot, RegenCaller.processBlock, shouldReload).then(
        (headStateRegen) => this.stateCache.setHeadState(headStateRegen),
        (e) => this.logger.error("Error on head state regen", {}, e)
      );
    }
  }

  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch): number | null {
    return this.checkpointStateCache.updatePreComputedCheckpoint(rootHex, epoch);
  }

  /**
   * Get the state to run with `block`.
   * - State after `block.parentRoot` dialed forward to block.slot
   */
  async getPreState(
    block: allForks.BeaconBlock,
    opts: StateCloneOpts,
    rCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks> {
    this.metrics?.regenFnCallTotal.inc({caller: rCaller, entrypoint: RegenFnName.getPreState});

    // First attempt to fetch the state from caches before queueing
    const parentRoot = toHexString(block.parentRoot);
    const parentBlock = this.forkChoice.getBlockHex(parentRoot);
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
      const checkpointState = this.checkpointStateCache.getLatest(parentRoot, blockEpoch);
      if (checkpointState && computeEpochAtSlot(checkpointState.slot) === blockEpoch) {
        return checkpointState;
      }
    }

    // Check the state cache, only if the state doesn't need to go through an epoch transition.
    // Otherwise the state transition may not be cached and wasted. Queue for regen since the
    // work required will still be significant.
    if (parentEpoch === blockEpoch) {
      const state = this.stateCache.get(parentBlock.stateRoot);
      if (state) {
        return state;
      }
    }

    // The state is not immediately available in the caches, enqueue the job
    this.metrics?.regenFnQueuedTotal.inc({caller: rCaller, entrypoint: RegenFnName.getPreState});
    return this.jobQueue.push({key: "getPreState", args: [block, opts, rCaller]});
  }

  async getCheckpointState(
    cp: phase0.Checkpoint,
    opts: StateCloneOpts,
    rCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks> {
    this.metrics?.regenFnCallTotal.inc({caller: rCaller, entrypoint: RegenFnName.getCheckpointState});

    // First attempt to fetch the state from cache before queueing
    const checkpointState = this.checkpointStateCache.get(toCheckpointHex(cp));
    if (checkpointState) {
      return checkpointState;
    }

    // The state is not immediately available in the caches, enqueue the job
    this.metrics?.regenFnQueuedTotal.inc({caller: rCaller, entrypoint: RegenFnName.getCheckpointState});
    return this.jobQueue.push({key: "getCheckpointState", args: [cp, opts, rCaller]});
  }

  /**
   * Get state of provided `blockRoot` and dial forward to `slot`
   * Use this api with care because we don't want the queue to be busy
   * For the context, gossip block validation uses this api so we want it to be as fast as possible
   * @returns
   */
  async getBlockSlotState(
    blockRoot: RootHex,
    slot: Slot,
    opts: StateCloneOpts,
    rCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks> {
    this.metrics?.regenFnCallTotal.inc({caller: rCaller, entrypoint: RegenFnName.getBlockSlotState});

    // The state is not immediately available in the caches, enqueue the job
    return this.jobQueue.push({key: "getBlockSlotState", args: [blockRoot, slot, opts, rCaller]});
  }

  async getState(stateRoot: RootHex, rCaller: RegenCaller): Promise<CachedBeaconStateAllForks> {
    this.metrics?.regenFnCallTotal.inc({caller: rCaller, entrypoint: RegenFnName.getState});

    // First attempt to fetch the state from cache before queueing
    const state = this.stateCache.get(stateRoot);
    if (state) {
      return state;
    }

    // The state is not immediately available in the cache, enqueue the job
    this.metrics?.regenFnQueuedTotal.inc({caller: rCaller, entrypoint: RegenFnName.getState});
    return this.jobQueue.push({key: "getState", args: [stateRoot, rCaller]});
  }

  private jobQueueProcessor = async (regenRequest: RegenRequest): Promise<CachedBeaconStateAllForks> => {
    const metricsLabels = {
      caller: regenRequest.args[regenRequest.args.length - 1] as RegenCaller,
      entrypoint: regenRequest.key as RegenFnName,
    };
    let timer;
    try {
      timer = this.metrics?.regenFnCallDuration.startTimer(metricsLabels);
      switch (regenRequest.key) {
        case "getPreState":
          return await this.regen.getPreState(...regenRequest.args);
        case "getCheckpointState":
          return await this.regen.getCheckpointState(...regenRequest.args);
        case "getBlockSlotState":
          return await this.regen.getBlockSlotState(...regenRequest.args);
        case "getState":
          return await this.regen.getState(...regenRequest.args);
      }
    } catch (e) {
      this.metrics?.regenFnTotalErrors.inc(metricsLabels);
      throw e;
    } finally {
      if (timer) timer();
    }
  };
}
