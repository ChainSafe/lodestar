import {BeaconBlock, Root, Checkpoint} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";

import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {ChainEventEmitter} from "./emitter";
import {IBeaconDb} from "../db";
import {ForkChoice} from "./forkChoice";
import {processSlotsToNearestCheckpoint, runStateTransition} from "./blocks/stateTransition";

export enum RegenErrorCode {
  ERR_BLOCK_NOT_IN_FORKCHOICE = "ERR_BLOCK_NOT_IN_FORKCHOICE",
  ERR_STATE_NOT_IN_FORKCHOICE = "ERR_STATE_NOT_IN_FORKCHOICE",
  ERR_NO_SEED_STATE = "ERR_NO_SEED_STATE",
  ERR_BLOCK_NOT_IN_DB = "ERR_BLOCK_NOT_IN_DB",
  ERR_STATE_TRANSITION_ERROR = "ERR_STATE_TRANSITION_ERROR",
}

export type RegenErrorType =
  | {
      code: RegenErrorCode.ERR_BLOCK_NOT_IN_FORKCHOICE;
      blockRoot: Root;
    }
  | {
      code: RegenErrorCode.ERR_STATE_NOT_IN_FORKCHOICE;
      stateRoot: Root;
    }
  | {
      code: RegenErrorCode.ERR_NO_SEED_STATE;
    }
  | {
      code: RegenErrorCode.ERR_BLOCK_NOT_IN_DB;
      blockRoot: Root;
    }
  | {
      code: RegenErrorCode.ERR_STATE_TRANSITION_ERROR;
      error: Error;
    };

export class RegenError extends Error {
  type: RegenErrorType;
  constructor(type: RegenErrorType) {
    super(type.code);
    this.type = type;
  }
}

/**
 * Regenerates states that have already been processed by the fork choice
 *
 * All requests are queued so that only a single state at a time may be regenerated at a time
 */
export class StateRegenerator {
  private config: IBeaconConfig;
  private emitter: ChainEventEmitter;
  private forkChoice: ForkChoice;
  private db: IBeaconDb;

  constructor({
    config,
    emitter,
    forkChoice,
    db,
  }: {
    config: IBeaconConfig;
    emitter: ChainEventEmitter;
    forkChoice: ForkChoice;
    db: IBeaconDb;
  }) {
    this.config = config;
    this.emitter = emitter;
    this.forkChoice = forkChoice;
    this.db = db;
  }

  /**
   * Return a valid pre-state for a beacon block, minimizing the amount of regeneration needed
   */
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
    const isCheckpointParent = parentBlock.slot % this.config.params.SLOTS_PER_EPOCH === 0;
    const isCheckpointBlock = block.slot % this.config.params.SLOTS_PER_EPOCH === 0;
    if (isCheckpointParent || (parentEpoch < blockEpoch && !isCheckpointBlock)) {
      // If the requested state crosses an epoch boundary and the block isn't a checkpoint block
      // then we may use the checkpoint state before the block. This may save us at least one epoch transition.
      return this.getCheckpointState({root: block.parentRoot, epoch: blockEpoch});
    } else {
      // Otherwise, get the state normally.
      return this.getState(parentBlock.stateRoot);
    }
  }

  /**
   * Return a valid checkpoint state, minimizing the amount of regeneration needed
   */
  async getCheckpointState(cp: Checkpoint): Promise<ITreeStateContext> {
    const latestCheckpointStateCtx = await this.db.checkpointStateCache.getLatest(cp);
    if (latestCheckpointStateCtx) {
      // If a checkpoint state exists with the given checkpoint root, it either is in requested epoch
      // or needs to have empty slots processed until the requested epoch
      if (cp.epoch === latestCheckpointStateCtx.epochCtx.currentShuffling.epoch) {
        return latestCheckpointStateCtx;
      }
      return await processSlotsToNearestCheckpoint(
        this.emitter,
        latestCheckpointStateCtx,
        computeStartSlotAtEpoch(this.config, cp.epoch)
      );
    } else {
      // Otherwise, use the fork choice to get the stateRoot from block at the checkpoint root
      // regenerate that state,
      // then process empty slots until the requested epoch
      const block = this.forkChoice.getBlock(cp.root);
      if (!block) {
        throw new RegenError({
          code: RegenErrorCode.ERR_BLOCK_NOT_IN_FORKCHOICE,
          blockRoot: cp.root,
        });
      }
      const blockStateCtx = await this.getState(block.stateRoot);
      return await processSlotsToNearestCheckpoint(
        this.emitter,
        blockStateCtx,
        computeStartSlotAtEpoch(this.config, cp.epoch)
      );
    }
  }

  /**
   * Return the state with `stateRoot`, minimizing the amount of regeneration needed
   */
  async getState(stateRoot: Root): Promise<ITreeStateContext> {
    // Trivial case, stateCtx at stateRoot is already cached
    const cachedStateCtx = await this.db.stateCache.get(stateRoot);
    if (cachedStateCtx) {
      return cachedStateCtx;
    }
    // Otherwise we have to use the fork choice to traverse backwards, block by block,
    // searching the state caches
    // then replay blocks forward to the desired stateRoot
    const Root = this.config.types.Root;
    const block = this.forkChoice
      .forwardIterateBlockSummaries()
      .find((summary) => Root.equals(summary.stateRoot, stateRoot));
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
    for (const b of blocksToReplay.reverse()) {
      const block = await this.db.block.get(b.blockRoot);
      if (!block) {
        throw new RegenError({
          code: RegenErrorCode.ERR_BLOCK_NOT_IN_DB,
          blockRoot: b.blockRoot,
        });
      }
      try {
        stateCtx = await runStateTransition(this.emitter, this.forkChoice, stateCtx, {
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
