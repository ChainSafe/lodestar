import {AbortSignal} from "@chainsafe/abort-controller";
import {phase0, Slot, allForks, RootHex, Epoch} from "@chainsafe/lodestar-types";
import {IForkChoice, IProtoBlock} from "@chainsafe/lodestar-fork-choice";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {CheckpointStateCache, StateContextCache, toCheckpointHex} from "../stateCache";
import {IMetrics} from "../../metrics";
import {JobItemQueue} from "../../util/queue";
import {IStateRegeneratorInternal, IStateCacheRegen, RegenCaller, RegenFnName} from "./interface";
import {StateRegenerator, RegenModules} from "./regen";
import {RegenError, RegenErrorCode} from "./errors";
import {toHexString} from "@chainsafe/ssz";
import {AttesterShuffling, processSlotsToNearestCheckpoint, ProposerShuffling} from ".";
import {MapDef} from "../../util/map";

const REGEN_QUEUE_MAX_LEN = 256;

type QueuedStateRegeneratorModules = RegenModules & {
  signal: AbortSignal;
};

type RegenRequestKey = keyof IStateRegeneratorInternal;
type RegenRequestByKey = {[K in RegenRequestKey]: {key: K; args: Parameters<IStateRegeneratorInternal[K]>}};
export type RegenRequest = RegenRequestByKey[RegenRequestKey];

type DependantRootHex = RootHex;
type HeadSummary = {
  stateRoot: RootHex;
  blockRoot: RootHex;
  slot: Slot;
  epoch: Epoch;
  targetRoot: RootHex;
  /** Decide next attester shuffling + proposer shuffling */
  dependantRootNext: DependantRootHex;
  /** Decide curr attester shuffling */
  dependantRootCurr: DependantRootHex;
  /** Decide prev attester shuffling */
  dependantRootPrev: DependantRootHex;
};

type ShufflingCheckpoint = {
  epoch: Epoch;
  dependantRoot: DependantRootHex;
};

type DependantRootCache = MapDef<
  Epoch,
  MapDef<DependantRootHex, Set<WeakRef<CachedBeaconState<allForks.BeaconState>>>>
>;

/**
 * Regenerates states that have already been processed by the fork choice
 *
 * All requests are queued so that only a single state at a time may be regenerated at a time
 */
export class QueuedStateRegenerator implements IStateCacheRegen {
  readonly jobQueue: JobItemQueue<[RegenRequest], CachedBeaconState<allForks.BeaconState>>;
  private regen: StateRegenerator;

  private forkChoice: IForkChoice;
  private stateCache: StateContextCache;
  private checkpointStateCache: CheckpointStateCache;
  private metrics: IMetrics | null;

  private head: HeadSummary;
  private headState: CachedBeaconState<allForks.BeaconState> | null = null;

  // Target: First block with <= slot to that epoch's first epoch
  // Dependant root: Last block in an epoch, decides epoch transition input state
  //
  // What happens on close to finalized block:
  // - Shortest (worst) case with "12" rule IV the minimum distance between clock and finalized block is 2 epochs
  // - Maximum distance between a valid attestation and the clock is 1 epoch
  // So the oldest dependant root we care about is the last block of the current finalized epoch - 1. Which is the
  // parent of the finalized block of the finalized block if the first slot of finalized epoch is skipped.
  //
  //      attestation               latest posible    current
  //   dependant root | finalized     attestation      clock
  //                 ▼ ▼                ▼                ▼
  // |----------------|----------------|----------------|------
  //                ep N             ep N+1)          ep N+2
  //
  private dependantRootCacheNext: DependantRootCache;
  private dependantRootCacheCurr: DependantRootCache;
  private dependantRootCachePrev: DependantRootCache;

  private proposerShufflingCache: Map<Epoch, Map<DependantRootHex, WeakRef<ProposerShuffling>>>;

  constructor(modules: QueuedStateRegeneratorModules) {
    this.head = getHeadSummary(modules.forkChoice, modules.forkChoice.getHead());

    this.regen = new StateRegenerator(modules);
    this.jobQueue = new JobItemQueue<[RegenRequest], CachedBeaconState<allForks.BeaconState>>(
      this.jobQueueProcessor,
      {maxLength: REGEN_QUEUE_MAX_LEN, signal: modules.signal},
      modules.metrics ? modules.metrics.regenQueue : undefined
    );
    this.forkChoice = modules.forkChoice;
    this.stateCache = modules.stateCache;
    this.checkpointStateCache = modules.checkpointStateCache;
    this.metrics = modules.metrics;
  }

  setHead(head: IProtoBlock, potentialHeadState?: CachedBeaconState<allForks.BeaconState>): void {
    this.head = getHeadSummary(this.forkChoice, head);

    const headState =
      potentialHeadState &&
      // Compare the slot to prevent comparing stateRoot which should be more expensive
      head.slot === potentialHeadState.slot &&
      head.stateRoot === toHexString(potentialHeadState.hashTreeRoot())
        ? potentialHeadState
        : this.checkpointStateCache.getLatest(head.blockRoot, Infinity) || this.stateCache.get(head.stateRoot);

    // State is available syncronously =D
    // Note: almost always the headState should be in the cache since it should be from a block recently processed
    if (headState) {
      this.headState = headState;
      return;
    }

    // Make the state temporarily unavailable, while regen gets the state. While headState = null, the node may halt,
    // but it will recover eventually once the headState is available.
    this.headState = null;
    this.getState(head.stateRoot, RegenCaller.regenHeadState)
      .then((state) => {
        this.headState = state;
      })
      .catch((e) => {
        (e as Error).message = `Head state ${head.slot} ${head.stateRoot} not available: ${(e as Error).message}`;
        throw e;
      });
  }

  addPostState(state: CachedBeaconState<allForks.BeaconState>, block: IProtoBlock): void {
    const stateEpoch = computeEpochAtSlot(state.slot);
    const stateEpochPlus1 = Math.max(stateEpoch - 1, 0);
    const stateEpochPlus2 = Math.max(stateEpoch - 2, 0);
    // TODO: Compute all the dependantRoots in one go
    const dependantRootEpoch = getDependantRootAtEpoch(this.forkChoice, block, stateEpoch);
    const dependantRootEpochPlus1 = getDependantRootAtEpoch(this.forkChoice, block, Math.max(stateEpochPlus1));
    const dependantRootEpochPlus2 = getDependantRootAtEpoch(this.forkChoice, block, Math.max(stateEpochPlus2));

    const stateWeakRef = new WeakRef(state);
    this.dependantRootCacheNext.getOrDefault(stateEpoch).getOrDefault(dependantRootEpoch).add(stateWeakRef);
    this.dependantRootCacheCurr.getOrDefault(stateEpochPlus1).getOrDefault(dependantRootEpochPlus1).add(stateWeakRef);
    this.dependantRootCachePrev.getOrDefault(stateEpochPlus2).getOrDefault(dependantRootEpochPlus2).add(stateWeakRef);
  }

  getHeadState(): CachedBeaconState<allForks.BeaconState> | null {
    return (
      this.headState ||
      // Fallback, check if head state is in cache
      (this.head?.stateRoot ? this.stateCache.get(this.head?.stateRoot) : null)
    );
  }

  async getHeadStateAtEpoch(epoch: Epoch): Promise<CachedBeaconState<allForks.BeaconState>> {
    if (!this.headState) {
      throw Error("Head state not available");
    }

    if (this.head.epoch <= epoch) {
      return this.headState;
    }

    const slot = computeStartSlotAtEpoch(epoch);
    return await processSlotsToNearestCheckpoint({}, this.headState, slot);
  }

  async getHeadStateAtSlot(slot: Slot): Promise<CachedBeaconState<allForks.BeaconState>> {
    if (!this.headState) {
      throw Error("Head state not available");
    }

    if (this.head.slot <= slot) {
      return this.headState;
    }

    return await processSlotsToNearestCheckpoint({}, this.headState, slot);
  }

  async getProposerShuffling(parentBlock: IProtoBlock, blockSlot: Slot): Promise<ProposerShuffling> {
    // Look for a state with the same shuffling checkpoint
    // else, trigger regen to get a state with shufflingCheckpoint
    const blockEpoch = computeEpochAtSlot(blockSlot);
    const dependantRoot = getDependantRootAtEpoch(this.forkChoice, parentBlock, blockEpoch);

    // Check head state
    if (this.headState) {
      if (this.head.epoch === blockEpoch) {
        if (this.head.dependantRootNext === dependantRoot) {
          return this.headState.proposers;
        }
      }

      // TODO: Cache previous block proposers
      // else if (this.head.epoch -1 === blockEpoch) {}
    }

    // Check cache by dependantRoot
    const states = this.dependantRootCacheNext.get(blockEpoch)?.get(dependantRoot);
    if (states) {
      for (const stateWeakRef of states) {
        const state = stateWeakRef.deref();
        if (state) {
          return state.proposers;
        } else {
          // TODO: Do metrics of GC'ed states
          states.delete(stateWeakRef);
        }
      }
    }

    // If no state in memory cache matches the dependantRoot go fetch to the DB.
    // The hot DB should contain all checkpoint between finalizated block and latest epoch.
    // If the state is not found, dial a parent state forward.
    const state = (await this.store.readCheckpointState(
      blockEpoch,
      dependantRoot
    )) as CachedBeaconState<allForks.BeaconState>;

    // TODO: Cache in memory

    return state.proposers;
  }

  async getAttesterShuffling(targetCheckpoint: phase0.Checkpoint): Promise<AttesterShuffling> {
    const targetBlock = this.forkChoice.getBlock(targetCheckpoint.root);
    if (!targetBlock) {
      throw Error(`Target block not found ${targetCheckpoint.root} epoch ${targetCheckpoint.epoch}`);
    }

    const epochCurr = targetCheckpoint.epoch;
    const epochNext = Math.max(epochCurr - 1, 0);
    const epochPrev = epochCurr + 1;

    // TODO: Do a smart getDependantRootAtEpoch() that computes everything in one go
    const dependantRoot = getDependantRootAtEpoch(this.forkChoice, targetBlock, epochNext);

    // Check head state
    if (this.headState) {
      if (this.head.epoch === epochCurr) {
        if (this.head.dependantRootCurr === dependantRoot) return this.headState.currentShuffling;
      } else if (this.head.epoch === epochNext) {
        if (this.head.dependantRootNext === dependantRoot) return this.headState.nextShuffling;
      } else if (this.head.epoch === epochPrev) {
        if (this.head.dependantRootPrev === dependantRoot) return this.headState.previousShuffling;
      }
    }

    // Try with current shufflings first
    const statesCurr = this.dependantRootCacheNext.get(epochCurr)?.get(dependantRoot);
    if (statesCurr) {
      for (const stateWeakRef of statesCurr) {
        const state = stateWeakRef.deref();
        if (state) {
          return state.currentShuffling;
        } else {
          // TODO: Do metrics of GC'ed states
          statesCurr.delete(stateWeakRef);
        }
      }
    }

    // Then next shufflings
    const statesNext = this.dependantRootCacheNext.get(epochNext)?.get(dependantRoot);
    if (statesNext) {
      for (const stateWeakRef of statesNext) {
        const state = stateWeakRef.deref();
        if (state) {
          return state.nextShuffling;
        } else {
          // TODO: Do metrics of GC'ed states
          statesNext.delete(stateWeakRef);
        }
      }
    }

    // Then previous shufflings
    const statesPrev = this.dependantRootCacheNext.get(epochPrev)?.get(dependantRoot);
    if (statesPrev) {
      for (const stateWeakRef of statesPrev) {
        const state = stateWeakRef.deref();
        if (state) {
          return state.previousShuffling;
        } else {
          // TODO: Do metrics of GC'ed states
          statesPrev.delete(stateWeakRef);
        }
      }
    }

    // If no state in memory cache matches the dependantRoot go fetch to the DB.
    // The hot DB should contain all checkpoint between finalizated block and latest epoch.
    // If the state is not found, dial a parent state forward.
    const state = (await this.store.readCheckpointState(
      epochNext,
      dependantRoot
    )) as CachedBeaconState<allForks.BeaconState>;

    // TODO: Cache in memory

    return state.nextShuffling;
  }

  /**
   * Returns the closest state to postState.currentJustifiedCheckpoint in the same fork as postState
   *
   * From the spec https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/fork-choice.md#get_latest_attesting_balance
   * The state from which to read balances is:
   *
   * ```python
   * state = store.checkpoint_states[store.justified_checkpoint]
   * ```
   *
   * ```python
   * def store_target_checkpoint_state(store: Store, target: Checkpoint) -> None:
   *    # Store target checkpoint state if not yet seen
   *    if target not in store.checkpoint_states:
   *        base_state = copy(store.block_states[target.root])
   *        if base_state.slot < compute_start_slot_at_epoch(target.epoch):
   *            process_slots(base_state, compute_start_slot_at_epoch(target.epoch))
   *        store.checkpoint_states[target] = base_state
   * ```
   *
   * So the state to get justified balances is the post state of `checkpoint.root` dialed forward to the first slot in
   * `checkpoint.epoch` if that block is not in `checkpoint.epoch`.
   */
  getStateForJustifiedBalances(
    postState: CachedBeaconState<allForks.BeaconState>,
    blockParentRoot: RootHex
  ): CachedBeaconState<allForks.BeaconState> {
    const justifiedCheckpoint = postState.currentJustifiedCheckpoint;
    const checkpointHex = toCheckpointHex(justifiedCheckpoint);
    const checkpointSlot = computeStartSlotAtEpoch(checkpointHex.epoch);

    // First, check if the checkpoint block in the checkpoint epoch, by getting the block summary from the fork-choice
    const checkpointBlock = this.forkChoice.getBlockHex(checkpointHex.rootHex);
    if (!checkpointBlock) {
      // Should never happen
      return postState;
    }

    // NOTE: The state of block checkpointHex.rootHex may be prior to the justified checkpoint if it was a skipped slot.
    if (checkpointBlock.slot >= checkpointSlot) {
      const checkpointBlockState = this.stateCache.get(checkpointBlock.stateRoot);
      if (checkpointBlockState) {
        return checkpointBlockState;
      }
    }

    // If here, the first slot of `checkpoint.epoch` is a skipped slot. Check if the state is in the checkpoint cache.
    // NOTE: This state and above are correct with the spec.
    // NOTE: If the first slot of the epoch was skipped and the node is syncing, this state won't be in the cache.
    const state = this.checkpointStateCache.get(checkpointHex);
    if (state) {
      return state;
    }

    // If it's not found, then find the oldest state in the same chain as this one
    // NOTE: If `block.message.parentRoot` is not in the fork-choice, `iterateAncestorBlocks()` returns `[]`
    // NOTE: This state is not be correct with the spec, it may have extra modifications from multiple blocks.
    //       However, it's a best effort before triggering an async regen process. In the future this should be fixed
    //       to use regen and get the correct state.
    let oldestState = postState;
    for (const parentBlock of this.forkChoice.iterateAncestorBlocks(blockParentRoot)) {
      // We want at least a state at the slot 0 of checkpoint.epoch
      if (parentBlock.slot < checkpointSlot) {
        break;
      }

      const parentBlockState = this.stateCache.get(parentBlock.stateRoot);
      if (parentBlockState) {
        oldestState = parentBlockState;
      }
    }

    // TODO: Use regen to get correct state. Note that making this function async can break the import flow.
    //       Also note that it can dead lock regen and block processing since both have a concurrency of 1.

    this.logger.error("State for currentJustifiedCheckpoint not available, using closest state", {
      checkpointEpoch: checkpointHex.epoch,
      checkpointRoot: checkpointHex.rootHex,
      stateSlot: oldestState.slot,
      stateRoot: toHexString(oldestState.hashTreeRoot()),
    });

    return oldestState;
  }

  /**
   * TEMP - To get states from API
   * Get state from memory cache doing no regen
   */
  getStateSync(stateRoot: RootHex): CachedBeaconState<allForks.BeaconState> | null {
    return this.stateCache.get(stateRoot);
  }

  /**
   * Get the state to run with `block`.
   * - State after `block.parentRoot` dialed forward to block.slot
   */
  async getPreState(
    block: allForks.BeaconBlock,
    rCaller: RegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
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
      if (checkpointState) {
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
    return this.jobQueue.push({key: "getPreState", args: [block, rCaller]});
  }

  async getCheckpointState(
    cp: phase0.Checkpoint,
    rCaller: RegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
    this.metrics?.regenFnCallTotal.inc({caller: rCaller, entrypoint: RegenFnName.getCheckpointState});

    // First attempt to fetch the state from cache before queueing
    const checkpointState = this.checkpointStateCache.get(toCheckpointHex(cp));
    if (checkpointState) {
      return checkpointState;
    }

    // The state is not immediately available in the caches, enqueue the job
    this.metrics?.regenFnQueuedTotal.inc({caller: rCaller, entrypoint: RegenFnName.getCheckpointState});
    return this.jobQueue.push({key: "getCheckpointState", args: [cp, rCaller]});
  }

  async getBlockSlotState(
    blockRoot: RootHex,
    slot: Slot,
    rCaller: RegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
    this.metrics?.regenFnCallTotal.inc({caller: rCaller, entrypoint: RegenFnName.getBlockSlotState});

    // The state is not immediately available in the caches, enqueue the job
    return this.jobQueue.push({key: "getBlockSlotState", args: [blockRoot, slot, rCaller]});
  }

  async getState(stateRoot: RootHex, rCaller: RegenCaller): Promise<CachedBeaconState<allForks.BeaconState>> {
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

  dropStateCaches(): void {
    this.stateCache.clear();
    this.checkpointStateCache.clear();
    this.dependantRootCacheNext.clear();
    this.dependantRootCacheCurr.clear();
    this.dependantRootCachePrev.clear();
  }

  private jobQueueProcessor = async (regenRequest: RegenRequest): Promise<CachedBeaconState<allForks.BeaconState>> => {
    const metricsLabels = {
      caller: regenRequest.args[regenRequest.args.length - 1] as RegenCaller,
      entrypoint: regenRequest.key,
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

/**
 * Returns the dependant root of `fromBlock` block ancestors that decided the epoch transition going into `epoch`.
 * `dependantRoot` is the block root of the last block in epoch `epoch - 1`, which may not be in `epoch - 1`.
 */
export function getDependantRootAtEpoch(forkChoice: IForkChoice, fromBlock: IProtoBlock, epoch: Epoch): RootHex {
  // Handle close to genesis
  if (epoch <= 0) {
    const finalizedCp = forkChoice.getFinalizedCheckpoint();
    if (finalizedCp.epoch === 0) {
      return finalizedCp.rootHex;
    } else {
      throw Error(`Can not get dependant root from epoch before finalized epoch ${finalizedCp.epoch}`);
    }
  }

  const dependantRootNextSlot = computeStartSlotAtEpoch(epoch);
  let block: IProtoBlock | null = fromBlock;

  while (block !== null) {
    if (block.slot === dependantRootNextSlot) {
      return block.parentRoot;
    } else if (block.slot < dependantRootNextSlot) {
      return block.blockRoot;
    }

    // TODO: Benchmark doing `block.slot % SLOTS_PER_EPOCH === 0`
    if (block.blockRoot === block.targetRoot) {
      block = forkChoice.getBlockHex(block.parentRoot);
    } else {
      block = forkChoice.getBlockHex(block.targetRoot);
    }
  }

  // Should never happen:
  //
  // Target: First block with <= slot to that epoch's first epoch
  // Dependant root: Last block in an epoch, decides epoch transition input state
  //
  // What happens on close to finalized block:
  // - Shortest (worst) case with "12" rule IV the minimum distance between clock and finalized block is 2 epochs
  // - Maximum distance between a valid attestation and the clock is 1 epoch
  // So the oldest dependant root we care about is the last block of the current finalized epoch - 1. Which is the
  // parent of the finalized block of the finalized block if the first slot of finalized epoch is skipped.
  //
  //      attestation               latest posible    current
  //   dependant root | finalized     attestation      clock
  //                 ▼ ▼                ▼                ▼
  // |----------------|----------------|----------------|------
  //                ep N             ep N+1)          ep N+2
  //
  const finalizedEpoch = forkChoice.getFinalizedCheckpoint().epoch;
  if (epoch < forkChoice.getFinalizedCheckpoint().epoch) {
    throw Error(`Can not get dependant root from epoch before finalized epoch ${finalizedEpoch}`);
  } else {
    throw Error(`Can not get dependant root for block ${fromBlock.blockRoot} slot ${fromBlock.slot}`);
  }
}

function getHeadSummary(forkChoice: IForkChoice, head: IProtoBlock): HeadSummary {
  const headEpoch = computeEpochAtSlot(head.slot);
  return {
    blockRoot: head.blockRoot,
    stateRoot: head.stateRoot,
    slot: head.slot,
    epoch: headEpoch,
    targetRoot: head.targetRoot,
    dependantRootNext: getDependantRootAtEpoch(forkChoice, head, headEpoch),
    dependantRootCurr: getDependantRootAtEpoch(forkChoice, head, Math.max(headEpoch - 1, 0)),
    dependantRootPrev: getDependantRootAtEpoch(forkChoice, head, Math.max(headEpoch - 2, 0)),
  };
}
