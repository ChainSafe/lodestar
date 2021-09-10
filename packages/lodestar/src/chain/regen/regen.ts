import {allForks, phase0, Slot, RootHex} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IForkChoice, IProtoBlock} from "@chainsafe/lodestar-fork-choice";
import {sleep} from "@chainsafe/lodestar-utils";

import {CheckpointStateCache, StateContextCache} from "../stateCache";
import {ChainEventEmitter} from "../emitter";
import {IBeaconDb} from "../../db";
import {processSlotsByCheckpoint, runStateTransition} from "../blocks/stateTransition";
import {IStateRegenerator, RegenCaller} from "./interface";
import {RegenError, RegenErrorCode} from "./errors";
import {IMetrics} from "../../metrics";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

/**
 * Regenerates states that have already been processed by the fork choice
 */
export class StateRegenerator implements IStateRegenerator {
  private config: IChainForkConfig;
  private emitter: ChainEventEmitter;
  private forkChoice: IForkChoice;
  private stateCache: StateContextCache;
  private checkpointStateCache: CheckpointStateCache;
  private db: IBeaconDb;
  private metrics: IMetrics | null;

  constructor({
    config,
    emitter,
    forkChoice,
    stateCache,
    checkpointStateCache,
    db,
    metrics,
  }: {
    config: IChainForkConfig;
    emitter: ChainEventEmitter;
    forkChoice: IForkChoice;
    stateCache: StateContextCache;
    checkpointStateCache: CheckpointStateCache;
    db: IBeaconDb;
    metrics: IMetrics | null;
  }) {
    this.config = config;
    this.emitter = emitter;
    this.forkChoice = forkChoice;
    this.stateCache = stateCache;
    this.checkpointStateCache = checkpointStateCache;
    this.db = db;
    this.metrics = metrics;
  }

  async getPreState(
    block: allForks.BeaconBlock,
    rCaller: RegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
    const parentBlock = this.forkChoice.getBlock(block.parentRoot);
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
      return await this.getCheckpointState({root: block.parentRoot, epoch: blockEpoch}, rCaller);
    }

    // Otherwise, get the state normally.
    return await this.getState(parentBlock.stateRoot, rCaller);
  }

  async getCheckpointState(
    cp: phase0.Checkpoint,
    rCaller: RegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
    const checkpointStartSlot = computeStartSlotAtEpoch(cp.epoch);
    return await this.getBlockSlotState(toHexString(cp.root), checkpointStartSlot, rCaller);
  }

  async getBlockSlotState(
    blockRoot: RootHex,
    slot: Slot,
    rCaller: RegenCaller
  ): Promise<CachedBeaconState<allForks.BeaconState>> {
    const block = this.forkChoice.getBlockHex(blockRoot);
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

    const latestCheckpointStateCtx = this.checkpointStateCache.getLatest(blockRoot, computeEpochAtSlot(slot));

    // If a checkpoint state exists with the given checkpoint root, it either is in requested epoch
    // or needs to have empty slots processed until the requested epoch
    if (latestCheckpointStateCtx) {
      return await processSlotsByCheckpoint(
        {emitter: this.emitter, metrics: this.metrics},
        latestCheckpointStateCtx,
        slot
      );
    }

    // Otherwise, use the fork choice to get the stateRoot from block at the checkpoint root
    // regenerate that state,
    // then process empty slots until the requested epoch
    const blockStateCtx = await this.getState(block.stateRoot, rCaller);
    return await processSlotsByCheckpoint({emitter: this.emitter, metrics: this.metrics}, blockStateCtx, slot);
  }

  async getState(stateRoot: RootHex, _rCaller: RegenCaller): Promise<CachedBeaconState<allForks.BeaconState>> {
    // Trivial case, state at stateRoot is already cached
    const cachedStateCtx = this.stateCache.get(stateRoot);
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
    let state: CachedBeaconState<allForks.BeaconState> | null = null;
    for (const b of this.forkChoice.iterateAncestorBlocks(block.parentRoot)) {
      state = this.stateCache.get(b.stateRoot);
      if (state) {
        break;
      }
      state = this.checkpointStateCache.getLatest(
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
      const structBlock = await this.db.block.get(fromHexString(b.blockRoot));
      if (!structBlock) {
        throw Error(`No block found for ${b.blockRoot}`);
      }
      const block = this.config.getForkTypes(b.slot).SignedBeaconBlock.createTreeBackedFromStruct(structBlock);
      if (!block) {
        throw new RegenError({
          code: RegenErrorCode.BLOCK_NOT_IN_DB,
          blockRoot: b.blockRoot,
        });
      }

      try {
        state = await runStateTransition(
          {emitter: this.emitter, forkChoice: this.forkChoice, metrics: this.metrics},
          this.checkpointStateCache,
          state,
          {signedBlock: block, reprocess: true, prefinalized: true, validSignatures: true, validProposerSignature: true}
        );
        // this avoids keeping our node busy processing blocks
        await sleep(0);
      } catch (e) {
        throw new RegenError({
          code: RegenErrorCode.STATE_TRANSITION_ERROR,
          error: e as Error,
        });
      }
    }

    return state as CachedBeaconState<allForks.BeaconState>;
  }

  private findFirstStateBlock(stateRoot: RootHex): IProtoBlock {
    for (const block of this.forkChoice.forwarditerateAncestorBlocks()) {
      if (block) {
        return block;
      }
    }

    throw new RegenError({
      code: RegenErrorCode.STATE_NOT_IN_FORKCHOICE,
      stateRoot,
    });
  }
}
