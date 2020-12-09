import {byteArrayEquals, TreeBacked} from "@chainsafe/ssz";
import {BeaconState, Slot} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {
  ZERO_HASH,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  fastStateTransition,
  IStateContext,
  toIStateContext,
} from "@chainsafe/lodestar-beacon-state-transition";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {
  getAllBlockSignatureSets,
  getAllBlockSignatureSetsExceptProposer,
} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/signatureSets";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {LodestarEpochContext, ITreeStateContext} from "../../db/api/beacon/stateContextCache";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IBlockJob} from "../interface";
import {sleep} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {BlockError, BlockErrorCode} from "../errors";
import {verifySignatureSetsBatch} from "../bls";
import {createCachedValidatorsBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {StateTransitionEpochContext} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/epochContext";

/**
 * Emits a properly formed "checkpoint" event, given a checkpoint state context
 *
 * This will throw an error if the checkpoint state is not a valid checkpoint state, eg: NOT the first slot in an epoch.
 */
export function emitCheckpointEvent(emitter: ChainEventEmitter, checkpointStateContext: ITreeStateContext): void {
  const config = checkpointStateContext.epochCtx.config;
  const slot = checkpointStateContext.state.slot;
  assert.true(slot % config.params.SLOTS_PER_EPOCH === 0, "Checkpoint state slot must be first in an epoch");
  const blockHeader = config.types.BeaconBlockHeader.clone(checkpointStateContext.state.latestBlockHeader);
  if (config.types.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = config.types.BeaconState.hashTreeRoot(checkpointStateContext.state);
  }
  emitter.emit(
    ChainEvent.checkpoint,
    {
      root: config.types.BeaconBlockHeader.hashTreeRoot(blockHeader),
      epoch: computeEpochAtSlot(config, slot),
    },
    checkpointStateContext
  );
}

export function cloneStateCtx(stateCtx: ITreeStateContext): ITreeStateContext {
  return {
    state: stateCtx.state.clone(),
    epochCtx: stateCtx.epochCtx.copy(),
  };
}

/**
 * Starting at `stateCtx.state.slot`,
 * process slots forward towards `slot`,
 * emitting "checkpoint" events after every epoch processed.
 *
 * Stops processing after no more full epochs can be processed.
 */
export async function processSlotsToNearestCheckpoint(
  emitter: ChainEventEmitter,
  stateCtx: ITreeStateContext,
  slot: Slot
): Promise<IStateContext> {
  const config = stateCtx.epochCtx.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const preSlot = stateCtx.state.slot;
  const postSlot = slot;
  const preEpoch = computeEpochAtSlot(config, preSlot);
  const postCtx = cloneStateCtx(stateCtx);
  const stateTransitionState = createCachedValidatorsBeaconState(postCtx.state);
  const stateTranstionEpochContext = new StateTransitionEpochContext(undefined, postCtx.epochCtx);
  for (
    let nextEpochSlot = computeStartSlotAtEpoch(config, preEpoch + 1);
    nextEpochSlot <= postSlot;
    nextEpochSlot += SLOTS_PER_EPOCH
  ) {
    processSlots(stateTranstionEpochContext, stateTransitionState, nextEpochSlot);
    const checkpointCtx = toTreeStateContext(toIStateContext(stateTranstionEpochContext, stateTransitionState));
    emitCheckpointEvent(emitter, cloneStateCtx(checkpointCtx));
    // this avoids keeping our node busy processing blocks
    await sleep(0);
  }
  return {
    epochCtx: stateTranstionEpochContext,
    state: stateTransitionState,
  };
}

/**
 * Starting at `stateCtx.state.slot`,
 * process slots forward towards `slot`,
 * emitting "checkpoint" events after every epoch processed.
 */
export async function processSlotsByCheckpoint(
  emitter: ChainEventEmitter,
  stateCtx: ITreeStateContext,
  slot: Slot
): Promise<ITreeStateContext> {
  const postCtx = await processSlotsToNearestCheckpoint(emitter, stateCtx, slot);
  if (postCtx.state.slot < slot) {
    processSlots(postCtx.epochCtx, postCtx.state, slot);
  }
  return toTreeStateContext(postCtx);
}

export function emitForkChoiceHeadEvents(
  emitter: ChainEventEmitter,
  forkChoice: IForkChoice,
  head: IBlockSummary,
  oldHead: IBlockSummary
): void {
  const headRoot = head.blockRoot;
  const oldHeadRoot = oldHead.blockRoot;
  if (!byteArrayEquals(headRoot, oldHeadRoot)) {
    // new head
    if (!forkChoice.isDescendant(oldHeadRoot, headRoot)) {
      // chain reorg
      const oldHeadHistory = forkChoice.iterateBlockSummaries(oldHeadRoot);
      const headHistory = forkChoice.iterateBlockSummaries(headRoot);
      const firstAncestor = headHistory.find((summary) => oldHeadHistory.includes(summary));
      const distance = oldHead.slot - (firstAncestor?.slot ?? oldHead.slot);
      emitter.emit(ChainEvent.forkChoiceReorg, head, oldHead, distance);
    }
    emitter.emit(ChainEvent.forkChoiceHead, head);
  }
}

export function emitBlockEvent(emitter: ChainEventEmitter, job: IBlockJob, postCtx: ITreeStateContext): void {
  emitter.emit(ChainEvent.block, job.signedBlock, postCtx, job);
}

export async function runStateTransition(
  emitter: ChainEventEmitter,
  forkChoice: IForkChoice,
  db: IBeaconDb,
  stateContext: ITreeStateContext,
  job: IBlockJob
): Promise<ITreeStateContext> {
  const config = stateContext.epochCtx.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const postSlot = job.signedBlock.message.slot;
  const checkpointStateContext = await processSlotsToNearestCheckpoint(emitter, stateContext, postSlot - 1);

  if (!job.validSignatures) {
    const {epochCtx, state} = checkpointStateContext;
    const signatureSets = job.validProposerSignature
      ? getAllBlockSignatureSetsExceptProposer(epochCtx, state, job.signedBlock)
      : getAllBlockSignatureSets(epochCtx, state, job.signedBlock);

    if (!verifySignatureSetsBatch(signatureSets)) {
      throw new BlockError({
        code: BlockErrorCode.INVALID_SIGNATURE,
        job,
      });
    }

    job.validProposerSignature = true;
    job.validSignatures = true;
  }

  // if block is trusted don't verify proposer or op signature
  const postStateContext = toTreeStateContext(
    fastStateTransition(checkpointStateContext, job.signedBlock, {
      verifyStateRoot: true,
      verifyProposer: !job.validSignatures && !job.validProposerSignature,
      verifySignatures: !job.validSignatures,
    })
  );

  const oldHead = forkChoice.getHead();

  // current justified checkpoint should be prev epoch or current epoch if it's just updated
  // it should always have epochBalances there bc it's a checkpoint state, ie got through processEpoch
  const justifiedBalances = (await db.checkpointStateCache.get(postStateContext.state.currentJustifiedCheckpoint))
    ?.epochCtx.epochBalances;
  forkChoice.onBlock(job.signedBlock.message, postStateContext.state, justifiedBalances);

  if (postSlot % SLOTS_PER_EPOCH === 0) {
    emitCheckpointEvent(emitter, postStateContext);
  }

  emitBlockEvent(emitter, job, postStateContext);
  emitForkChoiceHeadEvents(emitter, forkChoice, forkChoice.getHead(), oldHead);

  // this avoids keeping our node busy processing blocks
  await sleep(0);
  return postStateContext;
}

/**
 * Pull necessary data from epochProcess of exchange interface IStateContext
 * and transform to lodestar ITreeStateContext.
 * Make sure no epochProcess stays in ITreeStateContext.
 */
function toTreeStateContext(stateCtx: IStateContext): ITreeStateContext {
  const treeStateCtx: ITreeStateContext = {
    state: stateCtx.state.getOriginalState() as TreeBacked<BeaconState>,
    epochCtx: new LodestarEpochContext(undefined, stateCtx.epochCtx),
  };

  if (stateCtx.epochProcess) {
    treeStateCtx.epochCtx.epochBalances = stateCtx.epochProcess.statuses.map((s) =>
      s.active ? s.validator.effectiveBalance : BigInt(0)
    );
  }

  return treeStateCtx;
}
