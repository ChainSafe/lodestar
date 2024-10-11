import {phase0, Slot, RootHex, BeaconBlock, SignedBeaconBlock} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  ExecutionPayloadStatus,
  DataAvailableStatus,
  processSlots,
  stateTransition,
  StateHashTreeRootSource,
} from "@lodestar/state-transition";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {Logger, fromHex, toRootHex} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {Metrics} from "../../metrics/index.js";
import {IBeaconDb} from "../../db/index.js";
import {getCheckpointFromState} from "../blocks/utils/checkpoint.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";
import {CheckpointStateCache, BlockStateCache} from "../stateCache/types.js";
import {nextEventLoop} from "../../util/eventLoop.js";
import {IStateRegeneratorInternal, RegenCaller, StateCloneOpts} from "./interface.js";
import {RegenError, RegenErrorCode} from "./errors.js";

export type RegenModules = {
  db: IBeaconDb;
  forkChoice: IForkChoice;
  blockStateCache: BlockStateCache;
  checkpointStateCache: CheckpointStateCache;
  config: ChainForkConfig;
  emitter: ChainEventEmitter;
  logger: Logger;
  metrics: Metrics | null;
};

/**
 * Regenerates states that have already been processed by the fork choice
 * Since Feb 2024, we support reloading checkpoint state from disk via allowDiskReload flag. Due to its performance impact
 * this flag is only set to true in this case:
 *    - getPreState: this is for block processing, it's important to reload state in unfinality time
 *    - updateHeadState: rarely happen, but it's important to make sure we always can regen head state
 */
export class StateRegenerator implements IStateRegeneratorInternal {
  constructor(private readonly modules: RegenModules) {}

  /**
   * Get the state to run with `block`. May be:
   * - If parent is in same epoch -> Exact state at `block.parentRoot`
   * - If parent is in prev epoch -> State after `block.parentRoot` dialed forward through epoch transition
   * - reload state if needed in this flow
   */
  async getPreState(
    block: BeaconBlock,
    opts: StateCloneOpts,
    regenCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks> {
    const parentBlock = this.modules.forkChoice.getBlock(block.parentRoot);
    if (!parentBlock) {
      throw new RegenError({
        code: RegenErrorCode.BLOCK_NOT_IN_FORKCHOICE,
        blockRoot: block.parentRoot,
      });
    }

    const parentEpoch = computeEpochAtSlot(parentBlock.slot);
    const blockEpoch = computeEpochAtSlot(block.slot);
    const allowDiskReload = true;

    // This may save us at least one epoch transition.
    // If the requested state crosses an epoch boundary
    // then we may use the checkpoint state before the block
    // We may have the checkpoint state with parent root inside the checkpoint state cache
    // through gossip validation.
    if (parentEpoch < blockEpoch) {
      return this.getCheckpointState({root: block.parentRoot, epoch: blockEpoch}, opts, regenCaller, allowDiskReload);
    }

    // Otherwise, get the state normally.
    return this.getState(parentBlock.stateRoot, regenCaller, opts, allowDiskReload);
  }

  /**
   * Get state after block `cp.root` dialed forward to first slot of `cp.epoch`
   */
  async getCheckpointState(
    cp: phase0.Checkpoint,
    opts: StateCloneOpts,
    regenCaller: RegenCaller,
    allowDiskReload = false
  ): Promise<CachedBeaconStateAllForks> {
    const checkpointStartSlot = computeStartSlotAtEpoch(cp.epoch);
    return this.getBlockSlotState(toRootHex(cp.root), checkpointStartSlot, opts, regenCaller, allowDiskReload);
  }

  /**
   * Get state after block `blockRoot` dialed forward to `slot`
   *   - allowDiskReload should be used with care, as it will cause the state to be reloaded from disk
   */
  async getBlockSlotState(
    blockRoot: RootHex,
    slot: Slot,
    opts: StateCloneOpts,
    regenCaller: RegenCaller,
    allowDiskReload = false
  ): Promise<CachedBeaconStateAllForks> {
    const block = this.modules.forkChoice.getBlockHex(blockRoot);
    if (!block) {
      throw new RegenError({
        code: RegenErrorCode.BLOCK_NOT_IN_FORKCHOICE,
        blockRoot,
      });
    }

    if (slot < block.slot) {
      throw new RegenError({
        code: RegenErrorCode.SLOT_BEFORE_BLOCK_SLOT,
        slot,
        blockSlot: block.slot,
      });
    }

    const {checkpointStateCache} = this.modules;
    const epoch = computeEpochAtSlot(slot);
    const latestCheckpointStateCtx = allowDiskReload
      ? await checkpointStateCache.getOrReloadLatest(blockRoot, epoch, opts)
      : checkpointStateCache.getLatest(blockRoot, epoch, opts);

    // If a checkpoint state exists with the given checkpoint root, it either is in requested epoch
    // or needs to have empty slots processed until the requested epoch
    if (latestCheckpointStateCtx) {
      return processSlotsByCheckpoint(this.modules, latestCheckpointStateCtx, slot, regenCaller, opts);
    }

    // Otherwise, use the fork choice to get the stateRoot from block at the checkpoint root
    // regenerate that state,
    // then process empty slots until the requested epoch
    const blockStateCtx = await this.getState(block.stateRoot, regenCaller, opts, allowDiskReload);
    return processSlotsByCheckpoint(this.modules, blockStateCtx, slot, regenCaller, opts);
  }

  /**
   * Get state by exact root. If not in cache directly, requires finding the block that references the state from the
   * forkchoice and replaying blocks to get to it.
   *   - allowDiskReload should be used with care, as it will cause the state to be reloaded from disk
   */
  async getState(
    stateRoot: RootHex,
    caller: RegenCaller,
    opts?: StateCloneOpts,
    // internal option, don't want to expose to external caller
    allowDiskReload = false
  ): Promise<CachedBeaconStateAllForks> {
    // Trivial case, state at stateRoot is already cached
    const cachedStateCtx = this.modules.blockStateCache.get(stateRoot, opts);
    if (cachedStateCtx) {
      return cachedStateCtx;
    }

    // in block gossip validation (getPreState() call), dontTransferCache is specified as true because we only want to transfer cache in verifyBlocksStateTransitionOnly()
    // but here we want to process blocks as fast as possible so force to transfer cache in this case
    if (opts && allowDiskReload) {
      // if there is no `opts` specified, it already means "false"
      opts.dontTransferCache = false;
    }

    // Otherwise we have to use the fork choice to traverse backwards, block by block,
    // searching the state caches
    // then replay blocks forward to the desired stateRoot
    const block = this.findFirstStateBlock(stateRoot);

    // blocks to replay, ordered highest to lowest
    // gets reversed when replayed
    const blocksToReplay = [block];
    let state: CachedBeaconStateAllForks | null = null;
    const {checkpointStateCache} = this.modules;

    const getSeedStateTimer = this.modules.metrics?.regenGetState.getSeedState.startTimer({caller});
    // iterateAncestorBlocks only returns ancestor blocks, not the block itself
    for (const b of this.modules.forkChoice.iterateAncestorBlocks(block.blockRoot)) {
      state = this.modules.blockStateCache.get(b.stateRoot, opts);
      if (state) {
        break;
      }
      const epoch = computeEpochAtSlot(blocksToReplay[blocksToReplay.length - 1].slot - 1);
      state = allowDiskReload
        ? await checkpointStateCache.getOrReloadLatest(b.blockRoot, epoch, opts)
        : checkpointStateCache.getLatest(b.blockRoot, epoch, opts);
      if (state) {
        break;
      }
      blocksToReplay.push(b);
    }
    getSeedStateTimer?.();

    if (state === null) {
      throw new RegenError({
        code: RegenErrorCode.NO_SEED_STATE,
      });
    }

    const blockCount = blocksToReplay.length;
    const MAX_EPOCH_TO_PROCESS = 5;
    if (blockCount > MAX_EPOCH_TO_PROCESS * SLOTS_PER_EPOCH) {
      throw new RegenError({
        code: RegenErrorCode.TOO_MANY_BLOCK_PROCESSED,
        stateRoot,
      });
    }

    this.modules.metrics?.regenGetState.blockCount.observe({caller}, blockCount);

    const replaySlots = new Array<Slot>(blockCount);
    const blockPromises = new Array<Promise<SignedBeaconBlock | null>>(blockCount);

    const protoBlocksAsc = blocksToReplay.reverse();
    for (const [i, protoBlock] of protoBlocksAsc.entries()) {
      replaySlots[i] = protoBlock.slot;
      blockPromises[i] = this.modules.db.block.get(fromHex(protoBlock.blockRoot));
    }

    const logCtx = {stateRoot, caller, replaySlots: replaySlots.join(",")};
    this.modules.logger.debug("Replaying blocks to get state", logCtx);

    const loadBlocksTimer = this.modules.metrics?.regenGetState.loadBlocks.startTimer({caller});
    const blockOrNulls = await Promise.all(blockPromises);
    loadBlocksTimer?.();

    const blocksByRoot = new Map<RootHex, SignedBeaconBlock>();
    for (const [i, blockOrNull] of blockOrNulls.entries()) {
      // checking early here helps prevent unneccessary state transition below
      if (blockOrNull === null) {
        throw new RegenError({
          code: RegenErrorCode.BLOCK_NOT_IN_DB,
          blockRoot: protoBlocksAsc[i].blockRoot,
        });
      }
      blocksByRoot.set(protoBlocksAsc[i].blockRoot, blockOrNull);
    }

    const stateTransitionTimer = this.modules.metrics?.regenGetState.stateTransition.startTimer({caller});
    for (const b of protoBlocksAsc) {
      const block = blocksByRoot.get(b.blockRoot);
      // just to make compiler happy, we checked in the above for loop already
      if (block === undefined) {
        throw new RegenError({
          code: RegenErrorCode.BLOCK_NOT_IN_DB,
          blockRoot: b.blockRoot,
        });
      }

      try {
        // Only advances state trusting block's signture and hashes.
        // We are only running the state transition to get a specific state's data.
        state = stateTransition(
          state,
          block,
          {
            // Replay previously imported blocks, assume valid and available
            executionPayloadStatus: ExecutionPayloadStatus.valid,
            dataAvailableStatus: DataAvailableStatus.available,
            verifyStateRoot: false,
            verifyProposer: false,
            verifySignatures: false,
          },
          this.modules.metrics
        );

        const hashTreeRootTimer = this.modules.metrics?.stateHashTreeRootTime.startTimer({
          source: StateHashTreeRootSource.regenState,
        });
        const stateRoot = toRootHex(state.hashTreeRoot());
        hashTreeRootTimer?.();

        if (b.stateRoot !== stateRoot) {
          throw new RegenError({
            slot: b.slot,
            code: RegenErrorCode.INVALID_STATE_ROOT,
            actual: stateRoot,
            expected: b.stateRoot,
          });
        }

        if (allowDiskReload) {
          // also with allowDiskReload flag, we "reload" it to the state cache too
          this.modules.blockStateCache.add(state);
        }
      } catch (e) {
        throw new RegenError({
          code: RegenErrorCode.STATE_TRANSITION_ERROR,
          error: e as Error,
        });
      }
    }
    stateTransitionTimer?.();

    this.modules.logger.debug("Replayed blocks to get state", {...logCtx, stateSlot: state.slot});

    return state;
  }

  private findFirstStateBlock(stateRoot: RootHex): ProtoBlock {
    for (const block of this.modules.forkChoice.forwarditerateAncestorBlocks()) {
      if (block.stateRoot === stateRoot) {
        return block;
      }
    }

    throw new RegenError({
      code: RegenErrorCode.STATE_NOT_IN_FORKCHOICE,
      stateRoot,
    });
  }
}

/**
 * Starting at `state.slot`,
 * process slots forward towards `slot`,
 * emitting "checkpoint" events after every epoch processed.
 */
async function processSlotsByCheckpoint(
  modules: {checkpointStateCache: CheckpointStateCache; metrics: Metrics | null; emitter: ChainEventEmitter},
  preState: CachedBeaconStateAllForks,
  slot: Slot,
  regenCaller: RegenCaller,
  opts: StateCloneOpts
): Promise<CachedBeaconStateAllForks> {
  let postState = await processSlotsToNearestCheckpoint(modules, preState, slot, regenCaller, opts);
  if (postState.slot < slot) {
    postState = processSlots(postState, slot, opts, modules.metrics);
  }
  return postState;
}

/**
 * Starting at `state.slot`,
 * process slots forward towards `slot`,
 * emitting "checkpoint" events after every epoch processed.
 *
 * Stops processing after no more full epochs can be processed.
 */
async function processSlotsToNearestCheckpoint(
  modules: {checkpointStateCache: CheckpointStateCache; metrics: Metrics | null; emitter: ChainEventEmitter},
  preState: CachedBeaconStateAllForks,
  slot: Slot,
  regenCaller: RegenCaller,
  opts: StateCloneOpts
): Promise<CachedBeaconStateAllForks> {
  const preSlot = preState.slot;
  const postSlot = slot;
  const preEpoch = computeEpochAtSlot(preSlot);
  let postState = preState;
  const {checkpointStateCache, emitter, metrics} = modules;

  for (
    let nextEpochSlot = computeStartSlotAtEpoch(preEpoch + 1);
    nextEpochSlot <= postSlot;
    nextEpochSlot += SLOTS_PER_EPOCH
  ) {
    // processSlots calls .clone() before mutating
    postState = processSlots(postState, nextEpochSlot, opts, metrics);
    modules.metrics?.epochTransitionByCaller.inc({caller: regenCaller});

    // this is usually added when we prepare for next slot or validate gossip block
    // then when we process the 1st block of epoch, we don't have to do state transition again
    // This adds Previous Root Checkpoint State to the checkpoint state cache
    // This may becomes the "official" checkpoint state if the 1st block of epoch is skipped
    const checkpointState = postState;
    const cp = getCheckpointFromState(checkpointState);
    checkpointStateCache.add(cp, checkpointState);
    // consumers should not mutate or get the transfered cache
    emitter.emit(ChainEvent.checkpoint, cp, checkpointState.clone(true));

    // this avoids keeping our node busy processing blocks
    await nextEventLoop();
  }
  return postState;
}
