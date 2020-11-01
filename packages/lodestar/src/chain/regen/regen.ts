import {BeaconBlock, Checkpoint, Root, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";
import {ChainEventEmitter} from "../emitter";
import {IBeaconDb} from "../../db";
import {processSlotsByCheckpoint, runStateTransition} from "../blocks/stateTransition";
import {IStateRegenerator} from "./interface";
import {RegenError, RegenErrorCode} from "./errors";

/**
 * Regenerates states that have already been processed by the fork choice
 */
export class StateRegenerator implements IStateRegenerator {
  private config: IBeaconConfig;
  private emitter: ChainEventEmitter;
  private forkChoice: IForkChoice;
  private db: IBeaconDb;

  constructor({
    config,
    emitter,
    forkChoice,
    db,
  }: {
    config: IBeaconConfig;
    emitter: ChainEventEmitter;
    forkChoice: IForkChoice;
    db: IBeaconDb;
  }) {
    this.config = config;
    this.emitter = emitter;
    this.forkChoice = forkChoice;
    this.db = db;
  }

  async getPreState(block: BeaconBlock): Promise<ITreeStateContext> {
    const parentBlock = this.forkChoice.getBlock(block.parentRoot);
    if (!parentBlock) {
      throw new RegenError({
        code: RegenErrorCode.ERR_BLOCK_NOT_IN_FORKCHOICE,
        blockRoot: block.parentRoot,
      });
    }
    const parentEpoch = computeEpochAtSlot(this.config, parentBlock.slot);
    const blockEpoch = computeEpochAtSlot(this.config, block.slot);
    const isCheckpointBlock = block.slot % this.config.params.SLOTS_PER_EPOCH === 0;
    if (parentEpoch < blockEpoch && !isCheckpointBlock) {
      // If the requested state crosses an epoch boundary and the block isn't a checkpoint block
      // then we may use the checkpoint state before the block. This may save us at least one epoch transition.
      return this.getCheckpointState({root: block.parentRoot, epoch: blockEpoch});
    } else if (parentEpoch < blockEpoch - 1) {
      // If there's more than one epoch to pre-process (but the block is a checkpoint block)
      // get the checkpoint state as close as possible
      return this.getCheckpointState({root: block.parentRoot, epoch: blockEpoch - 1});
    } else {
      // Otherwise, get the state normally.
      return this.getState(parentBlock.stateRoot);
    }
  }

  async getCheckpointState(cp: Checkpoint): Promise<ITreeStateContext> {
    const checkpointStartSlot = computeStartSlotAtEpoch(this.config, cp.epoch);
    return await this.getBlockSlotState(cp.root, checkpointStartSlot);
  }

  async getBlockSlotState(blockRoot: Root, slot: Slot): Promise<ITreeStateContext> {
    const block = this.forkChoice.getBlock(blockRoot);
    if (!block) {
      throw new RegenError({
        code: RegenErrorCode.ERR_BLOCK_NOT_IN_FORKCHOICE,
        blockRoot,
      });
    }
    if (slot < block.slot) {
      throw new RegenError({
        code: RegenErrorCode.ERR_SLOT_BEFORE_BLOCK_SLOT,
        slot,
        blockSlot: block.slot,
      });
    }
    const cp = {
      root: blockRoot,
      epoch: computeEpochAtSlot(this.config, slot),
    };
    const latestCheckpointStateCtx = await this.db.checkpointStateCache.getLatest(cp);
    if (latestCheckpointStateCtx) {
      // If a checkpoint state exists with the given checkpoint root, it either is in requested epoch
      // or needs to have empty slots processed until the requested epoch
      return await processSlotsByCheckpoint(this.emitter, latestCheckpointStateCtx, slot);
    } else {
      // Otherwise, use the fork choice to get the stateRoot from block at the checkpoint root
      // regenerate that state,
      // then process empty slots until the requested epoch
      const blockStateCtx = await this.getState(block.stateRoot);
      return await processSlotsByCheckpoint(this.emitter, blockStateCtx, slot);
    }
  }

  async getState(stateRoot: Root): Promise<ITreeStateContext> {
    // Trivial case, stateCtx at stateRoot is already cached
    const cachedStateCtx = await this.db.stateCache.get(stateRoot);
    if (cachedStateCtx) {
      return cachedStateCtx;
    }
    // Otherwise we have to use the fork choice to traverse backwards, block by block,
    // searching the state caches
    // then replay blocks forward to the desired stateRoot
    const rootType = this.config.types.Root;
    const block = this.forkChoice
      .forwardIterateBlockSummaries()
      .find((summary) => rootType.equals(summary.stateRoot, stateRoot));
    if (!block) {
      throw new RegenError({
        code: RegenErrorCode.ERR_STATE_NOT_IN_FORKCHOICE,
        stateRoot,
      });
    }
    // blocks to replay, ordered highest to lowest
    // gets reversed when replayed
    const blocksToReplay = [block];
    let stateCtx: ITreeStateContext | null = null;
    for (const b of this.forkChoice.iterateBlockSummaries(block.parentRoot)) {
      stateCtx = await this.db.stateCache.get(b.stateRoot);
      if (stateCtx) {
        break;
      }
      stateCtx = await this.db.checkpointStateCache.getLatest({
        root: b.blockRoot,
        epoch: computeEpochAtSlot(this.config, blocksToReplay[blocksToReplay.length - 1].slot - 1),
      });
      if (stateCtx) {
        break;
      }
      blocksToReplay.push(b);
    }
    if (stateCtx === null) {
      throw new RegenError({
        code: RegenErrorCode.ERR_NO_SEED_STATE,
      });
    }
    const MAX_EPOCH_TO_PROCESS = 5;
    if (blocksToReplay.length > MAX_EPOCH_TO_PROCESS * this.config.params.SLOTS_PER_EPOCH) {
      throw new RegenError({
        code: RegenErrorCode.ERR_TOO_MANY_BLOCK_PROCESSED,
        stateRoot,
      });
    }
    for (const b of blocksToReplay.reverse()) {
      const block = await this.db.block.get(b.blockRoot);
      if (!block) {
        throw new RegenError({
          code: RegenErrorCode.ERR_BLOCK_NOT_IN_DB,
          blockRoot: b.blockRoot,
        });
      }
      try {
        stateCtx = await runStateTransition(this.emitter, this.forkChoice, this.db, stateCtx, {
          signedBlock: block,
          trusted: true,
          reprocess: true,
        });
      } catch (e) {
        throw new RegenError({
          code: RegenErrorCode.ERR_STATE_TRANSITION_ERROR,
          error: e,
        });
      }
    }
    return stateCtx;
  }
}
