import {allForks, phase0, Slot, RootHex} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  processSlots,
  stateTransition,
} from "@lodestar/state-transition";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {sleep} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {Metrics} from "../../metrics/index.js";
import {IBeaconDb} from "../../db/index.js";
import {CheckpointStateCache, StateContextCache} from "../stateCache/index.js";
import {getCheckpointFromState} from "../blocks/utils/checkpoint.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";
import {IStateRegenerator, RegenCaller, StateCloneOpts} from "./interface.js";
import {RegenError, RegenErrorCode} from "./errors.js";

export type RegenModules = {
  db: IBeaconDb;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  config: ChainForkConfig;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
};

/**
 * Regenerates states that have already been processed by the fork choice
 */
export class StateRegenerator implements IStateRegenerator {
  constructor(private readonly modules: RegenModules) {}

  /**
   * Get the state to run with `block`. May be:
   * - If parent is in same epoch -> Exact state at `block.parentRoot`
   * - If parent is in prev epoch -> State after `block.parentRoot` dialed forward through epoch transition
   */
  async getPreState(
    block: allForks.BeaconBlock,
    opts: StateCloneOpts,
    rCaller: RegenCaller
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

    // This may save us at least one epoch transition.
    // If the requested state crosses an epoch boundary
    // then we may use the checkpoint state before the block
    // We may have the checkpoint state with parent root inside the checkpoint state cache
    // through gossip validation.
    if (parentEpoch < blockEpoch) {
      return this.getCheckpointState({root: block.parentRoot, epoch: blockEpoch}, opts, rCaller);
    }

    // Otherwise, get the state normally.
    return this.getState(parentBlock.stateRoot, rCaller);
  }

  /**
   * Get state after block `cp.root` dialed forward to first slot of `cp.epoch`
   */
  async getCheckpointState(
    cp: phase0.Checkpoint,
    opts: StateCloneOpts,
    rCaller: RegenCaller
  ): Promise<CachedBeaconStateAllForks> {
    const checkpointStartSlot = computeStartSlotAtEpoch(cp.epoch);
    return this.getBlockSlotState(toHexString(cp.root), checkpointStartSlot, opts, rCaller);
  }

  /**
   * Get state after block `blockRoot` dialed forward to `slot`
   */
  async getBlockSlotState(
    blockRoot: RootHex,
    slot: Slot,
    opts: StateCloneOpts,
    rCaller: RegenCaller
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

    const latestCheckpointStateCtx = this.modules.checkpointStateCache.getLatest(blockRoot, computeEpochAtSlot(slot));

    // If a checkpoint state exists with the given checkpoint root, it either is in requested epoch
    // or needs to have empty slots processed until the requested epoch
    if (latestCheckpointStateCtx) {
      return processSlotsByCheckpoint(this.modules, latestCheckpointStateCtx, slot, opts);
    }

    // Otherwise, use the fork choice to get the stateRoot from block at the checkpoint root
    // regenerate that state,
    // then process empty slots until the requested epoch
    const blockStateCtx = await this.getState(block.stateRoot, rCaller);
    return processSlotsByCheckpoint(this.modules, blockStateCtx, slot, opts);
  }

  /**
   * Get state by exact root. If not in cache directly, requires finding the block that references the state from the
   * forkchoice and replaying blocks to get to it.
   */
  async getState(stateRoot: RootHex, _rCaller: RegenCaller): Promise<CachedBeaconStateAllForks> {
    // Trivial case, state at stateRoot is already cached
    const cachedStateCtx = this.modules.stateCache.get(stateRoot);
    if (cachedStateCtx) {
      return cachedStateCtx;
    }

    // Otherwise we have to use the fork choice to traverse backwards, block by block,
    // searching the state caches
    // then replay blocks forward to the desired stateRoot
    const block = this.findFirstStateBlock(stateRoot);

    // blocks to replay, ordered highest to lowest
    // gets reversed when replayed
    const blocksToReplay = [block];
    let state: CachedBeaconStateAllForks | null = null;
    for (const b of this.modules.forkChoice.iterateAncestorBlocks(block.parentRoot)) {
      state = this.modules.stateCache.get(b.stateRoot);
      if (state) {
        break;
      }
      state = this.modules.checkpointStateCache.getLatest(
        b.blockRoot,
        computeEpochAtSlot(blocksToReplay[blocksToReplay.length - 1].slot - 1)
      );
      if (state) {
        break;
      }
      blocksToReplay.push(b);
    }

    if (state === null) {
      throw new RegenError({
        code: RegenErrorCode.NO_SEED_STATE,
      });
    }

    const MAX_EPOCH_TO_PROCESS = 5;
    if (blocksToReplay.length > MAX_EPOCH_TO_PROCESS * SLOTS_PER_EPOCH) {
      throw new RegenError({
        code: RegenErrorCode.TOO_MANY_BLOCK_PROCESSED,
        stateRoot,
      });
    }

    for (const b of blocksToReplay.reverse()) {
      const block = await this.modules.db.block.get(fromHexString(b.blockRoot));
      if (!block) {
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
          null
        );

        // TODO: Persist states, note that regen could be triggered by old states.
        // Should those take a place in the cache?

        // this avoids keeping our node busy processing blocks
        await sleep(0);
      } catch (e) {
        throw new RegenError({
          code: RegenErrorCode.STATE_TRANSITION_ERROR,
          error: e as Error,
        });
      }
    }

    return state;
  }

  private findFirstStateBlock(stateRoot: RootHex): ProtoBlock {
    for (const block of this.modules.forkChoice.forwarditerateAncestorBlocks()) {
      if (block !== undefined) {
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
  opts: StateCloneOpts
): Promise<CachedBeaconStateAllForks> {
  let postState = await processSlotsToNearestCheckpoint(modules, preState, slot, opts);
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

    // Cache state to preserve epoch transition work
    const checkpointState = postState;
    const cp = getCheckpointFromState(checkpointState);
    checkpointStateCache.add(cp, checkpointState);
    emitter.emit(ChainEvent.checkpoint, cp, checkpointState);

    // this avoids keeping our node busy processing blocks
    await sleep(0);
  }
  return postState;
}
