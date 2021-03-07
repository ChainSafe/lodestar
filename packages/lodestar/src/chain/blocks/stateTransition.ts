import {byteArrayEquals} from "@chainsafe/ssz";
import {Gwei, Slot} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot, computeStartSlotAtEpoch, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ZERO_HASH} from "../../constants";
import {CheckpointStateCache} from "../stateCache";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IBlockJob, ITreeStateContext} from "../interface";
import {sleep} from "@chainsafe/lodestar-utils";

/**
 * Emits a properly formed "checkpoint" event, given a checkpoint state context
 *
 * This will throw an error if the checkpoint state is not a valid checkpoint state, eg: NOT the first slot in an epoch.
 */
export function emitCheckpointEvent(emitter: ChainEventEmitter, checkpointStateContext: ITreeStateContext): void {
  const config = checkpointStateContext.epochCtx.config;
  const slot = checkpointStateContext.state.slot;
  assert.true(slot % config.params.SLOTS_PER_EPOCH === 0, "Checkpoint state slot must be first in an epoch");
  const blockHeader = config.types.phase0.BeaconBlockHeader.clone(checkpointStateContext.state.latestBlockHeader);
  if (config.types.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = config.types.phase0.BeaconState.hashTreeRoot(checkpointStateContext.state);
  }
  emitter.emit(
    ChainEvent.checkpoint,
    {
      root: config.types.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader),
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
): Promise<phase0.fast.IStateContext> {
  const config = stateCtx.epochCtx.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const preSlot = stateCtx.state.slot;
  const postSlot = slot;
  const preEpoch = computeEpochAtSlot(config, preSlot);
  const postCtx = cloneStateCtx(stateCtx);
  for (
    let nextEpochSlot = computeStartSlotAtEpoch(config, preEpoch + 1);
    nextEpochSlot <= postSlot;
    nextEpochSlot += SLOTS_PER_EPOCH
  ) {
    phase0.fast.processSlots(postCtx.epochCtx, postCtx.state, nextEpochSlot);
    emitCheckpointEvent(emitter, cloneStateCtx(postCtx));
    // this avoids keeping our node busy processing blocks
    await sleep(0);
  }
  return postCtx;
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
    phase0.fast.processSlots(postCtx.epochCtx, postCtx.state, slot);
  }
  return postCtx;
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
  checkpointStateCache: CheckpointStateCache,
  stateContext: ITreeStateContext,
  job: IBlockJob
): Promise<ITreeStateContext> {
  const config = stateContext.epochCtx.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const postSlot = job.signedBlock.message.slot;

  // if block is trusted don't verify proposer or op signature
  const postStateContext = phase0.fast.fastStateTransition(stateContext, job.signedBlock, {
    verifyStateRoot: true,
    verifyProposer: !job.validSignatures && !job.validProposerSignature,
    verifySignatures: !job.validSignatures,
  });

  const oldHead = forkChoice.getHead();

  // current justified checkpoint should be prev epoch or current epoch if it's just updated
  // it should always have epochBalances there bc it's a checkpoint state, ie got through processEpoch
  const justifiedBalances: Gwei[] = [];
  if (postStateContext.state.currentJustifiedCheckpoint.epoch > forkChoice.getJustifiedCheckpoint().epoch) {
    const justifiedStateContext = checkpointStateCache.get(postStateContext.state.currentJustifiedCheckpoint);
    const justifiedEpoch = justifiedStateContext?.epochCtx.currentShuffling.epoch;
    justifiedStateContext?.state.flatValidators().readOnlyForEach((v) => {
      justifiedBalances.push(phase0.fast.isActiveIFlatValidator(v, justifiedEpoch!) ? v.effectiveBalance : BigInt(0));
    });
  }
  forkChoice.onBlock(job.signedBlock.message, postStateContext.state.getOriginalState(), justifiedBalances);

  if (postSlot % SLOTS_PER_EPOCH === 0) {
    emitCheckpointEvent(emitter, postStateContext);
  }

  emitBlockEvent(emitter, job, postStateContext);
  emitForkChoiceHeadEvents(emitter, forkChoice, forkChoice.getHead(), oldHead);

  // this avoids keeping our node busy processing blocks
  await sleep(0);
  return postStateContext;
}
