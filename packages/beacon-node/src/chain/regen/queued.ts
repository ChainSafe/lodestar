import {phase0, Slot, RootHex, Epoch, BeaconBlock} from "@lodestar/types";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks, UnfinalizedPubkeyIndexMap, computeEpochAtSlot} from "@lodestar/state-transition";
import {Logger, toRootHex} from "@lodestar/utils";
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
  private readonly blockStateCache: BlockStateCache;
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
    this.blockStateCache = modules.blockStateCache;
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
    this.blockStateCache.clear();
    this.checkpointStateCache.clear();
  }

  dumpCacheSummary(): routes.lodestar.StateCacheItem[] {
    return [...this.blockStateCache.dumpSummary(), ...this.checkpointStateCache.dumpSummary()];
  }

  /**
   * Get a state from block state cache.
   * This is not for block processing so don't transfer cache
   */
  getStateSync(stateRoot: RootHex): CachedBeaconStateAllForks | null {
    return this.blockStateCache.get(stateRoot, {dontTransferCache: true});
  }

  /**
   * Get state for block processing.
   * By default, do not transfer cache except for the block at clock slot
   * which is usually the gossip block.
   */
  getPreStateSync(
    block: BeaconBlock,
    opts: StateCloneOpts = {dontTransferCache: true}
  ): CachedBeaconStateAllForks | null {
    const parentRoot = toRootHex(block.parentRoot);
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
      const checkpointState = this.checkpointStateCache.getLatest(parentRoot, blockEpoch, opts);
      if (checkpointState && computeEpochAtSlot(checkpointState.slot) === blockEpoch) {
        return checkpointState;
      }
    }

    // Check the state cache, only if the state doesn't need to go through an epoch transition.
    // Otherwise the state transition may not be cached and wasted. Queue for regen since the
    // work required will still be significant.
    if (parentEpoch === blockEpoch) {
      const state = this.blockStateCache.get(parentBlock.stateRoot, opts);
      if (state) {
        return state;
      }
    }

    return null;
  }

  async getCheckpointStateOrBytes(cp: CheckpointHex): Promise<CachedBeaconStateAllForks | Uint8Array | null> {
    return this.checkpointStateCache.getStateOrBytes(cp);
  }

  /**
   * Get checkpoint state from cache, this function is not for block processing so don't transfer cache
   */
  getCheckpointStateSync(cp: CheckpointHex): CachedBeaconStateAllForks | null {
    return this.checkpointStateCache.get(cp, {dontTransferCache: true});
  }

  /**
   * Get state closest to head, this function is not for block processing so don't transfer cache
   */
  getClosestHeadState(head: ProtoBlock): CachedBeaconStateAllForks | null {
    const opts = {dontTransferCache: true};
    return (
      this.checkpointStateCache.getLatest(head.blockRoot, Infinity, opts) ||
      this.blockStateCache.get(head.stateRoot, opts)
    );
  }

  pruneOnCheckpoint(finalizedEpoch: Epoch, justifiedEpoch: Epoch, headStateRoot: RootHex): void {
    this.checkpointStateCache.prune(finalizedEpoch, justifiedEpoch);
    this.blockStateCache.prune(headStateRoot);
  }

  pruneOnFinalized(finalizedEpoch: number): Map<Epoch, CachedBeaconStateAllForks[]> | null {
    const prunedStates = this.checkpointStateCache.pruneFinalized(finalizedEpoch);
    this.blockStateCache.deleteAllBeforeEpoch(finalizedEpoch);

    return prunedStates;
  }

  async processState(
    blockRootHex: RootHex,
    postState: CachedBeaconStateAllForks
  ): Promise<Map<Epoch, CachedBeaconStateAllForks[]> | null> {
    this.blockStateCache.add(postState);
    let prunedStates: Map<Epoch, CachedBeaconStateAllForks[]> | null = null;
    try {
      prunedStates = await this.checkpointStateCache.processState(blockRootHex, postState);
    } catch (e) {
      this.logger.debug("Error processing block state", {blockRootHex, slot: postState.slot}, e as Error);
    }

    return prunedStates;
  }

  addCheckpointState(cp: phase0.Checkpoint, item: CachedBeaconStateAllForks): void {
    this.checkpointStateCache.add(cp, item);
  }

  updateHeadState(newHead: ProtoBlock, maybeHeadState: CachedBeaconStateAllForks): void {
    const {stateRoot: newHeadStateRoot, blockRoot: newHeadBlockRoot, slot: newHeadSlot} = newHead;
    const maybeHeadStateRoot = toRootHex(maybeHeadState.hashTreeRoot());
    const logCtx = {
      newHeadSlot,
      newHeadBlockRoot,
      newHeadStateRoot,
      maybeHeadSlot: maybeHeadState.slot,
      maybeHeadStateRoot,
    };
    const headState =
      newHeadStateRoot === maybeHeadStateRoot
        ? maybeHeadState
        : // maybeHeadState was already in block state cache so we don't transfer the cache
          this.blockStateCache.get(newHeadStateRoot, {dontTransferCache: true});

    if (headState) {
      this.blockStateCache.setHeadState(headState);
    } else {
      // Trigger regen on head change if necessary
      this.logger.warn("Head state not available, triggering regen", logCtx);
      // for the old BlockStateCacheImpl only
      //     - head has changed, so the existing cached head state is no longer useful. Set strong reference to null to free
      //       up memory for regen step below. During regen, node won't be functional but eventually head will be available
      // for the new FIFOBlockStateCache, this has no affect
      this.blockStateCache.setHeadState(null);

      // for the new FIFOBlockStateCache, it's important to reload state to regen head state here if needed
      const allowDiskReload = true;
      // transfer cache here because we want to regen state asap
      const cloneOpts = {dontTransferCache: false};
      this.regen.getState(newHeadStateRoot, RegenCaller.processBlock, cloneOpts, allowDiskReload).then(
        (headStateRegen) => this.blockStateCache.setHeadState(headStateRegen),
        (e) => this.logger.error("Error on head state regen", logCtx, e)
      );
    }
  }

  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch): number | null {
    return this.checkpointStateCache.updatePreComputedCheckpoint(rootHex, epoch);
  }

  /**
   * Remove `validators` from all unfinalized cache's epochCtx.UnfinalizedPubkey2Index,
   * and add them to epochCtx.pubkey2index and epochCtx.index2pubkey
   */
  updateUnfinalizedPubkeys(validators: UnfinalizedPubkeyIndexMap): void {
    let numStatesUpdated = 0;
    const states = this.blockStateCache.getStates();
    const cpStates = this.checkpointStateCache.getStates();

    // Add finalized pubkeys to all states.
    const addTimer = this.metrics?.regenFnAddPubkeyTime.startTimer();

    // We only need to add pubkeys to any one of the states since the finalized caches is shared globally across all states
    const firstState = (states.next().value ?? cpStates.next().value) as CachedBeaconStateAllForks | undefined;

    if (firstState !== undefined) {
      firstState.epochCtx.addFinalizedPubkeys(validators, this.metrics?.epochCache ?? undefined);
    } else {
      this.logger.warn("Attempt to delete finalized pubkey from unfinalized pubkey cache. But no state is available");
    }

    addTimer?.();

    // Delete finalized pubkeys from unfinalized pubkey cache for all states
    const deleteTimer = this.metrics?.regenFnDeletePubkeyTime.startTimer();
    const pubkeysToDelete = Array.from(validators.keys());

    for (const s of states) {
      s.epochCtx.deleteUnfinalizedPubkeys(pubkeysToDelete);
      numStatesUpdated++;
    }

    for (const s of cpStates) {
      s.epochCtx.deleteUnfinalizedPubkeys(pubkeysToDelete);
      numStatesUpdated++;
    }

    // Since first state is consumed from the iterator. Will need to perform delete explicitly
    if (firstState !== undefined) {
      firstState?.epochCtx.deleteUnfinalizedPubkeys(pubkeysToDelete);
      numStatesUpdated++;
    }

    deleteTimer?.();

    this.metrics?.regenFnNumStatesUpdated.observe(numStatesUpdated);
  }

  /**
   * Get the state to run with `block`.
   * - State after `block.parentRoot` dialed forward to block.slot
   */
  async getPreState(
    block: BeaconBlock,
    opts: StateCloneOpts,
    rCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks> {
    this.metrics?.regenFnCallTotal.inc({caller: rCaller, entrypoint: RegenFnName.getPreState});

    // First attempt to fetch the state from caches before queueing
    const cachedState = this.getPreStateSync(block, opts);

    if (cachedState !== null) {
      return cachedState;
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
    const checkpointState = this.checkpointStateCache.get(toCheckpointHex(cp), opts);
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

  async getState(
    stateRoot: RootHex,
    rCaller: RegenCaller,
    opts: StateCloneOpts = {dontTransferCache: true}
  ): Promise<CachedBeaconStateAllForks> {
    this.metrics?.regenFnCallTotal.inc({caller: rCaller, entrypoint: RegenFnName.getState});

    // First attempt to fetch the state from cache before queueing
    const state = this.blockStateCache.get(stateRoot, opts);
    if (state) {
      return state;
    }

    // The state is not immediately available in the cache, enqueue the job
    this.metrics?.regenFnQueuedTotal.inc({caller: rCaller, entrypoint: RegenFnName.getState});
    return this.jobQueue.push({key: "getState", args: [stateRoot, rCaller, opts]});
  }

  private jobQueueProcessor = async (regenRequest: RegenRequest): Promise<CachedBeaconStateAllForks> => {
    const metricsLabels = {
      caller: regenRequest.args[regenRequest.args.length - 1] as RegenCaller,
      entrypoint: regenRequest.key as RegenFnName,
    };
    let timer: (() => number) | undefined;
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
