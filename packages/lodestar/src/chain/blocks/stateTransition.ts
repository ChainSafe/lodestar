import {byteArrayEquals} from "@chainsafe/ssz";
import {Gwei, Slot} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {
  ZERO_HASH,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  fastStateTransition,
} from "@chainsafe/lodestar-beacon-state-transition";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IBlockJob} from "../interface";
import {sleep} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {CachedBeaconState, isActiveIFlatValidator} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

/**
 * Emits a properly formed "checkpoint" event, given a checkpoint state context
 *
 * This will throw an error if the checkpoint state is not a valid checkpoint state, eg: NOT the first slot in an epoch.
 */
export function emitCheckpointEvent(emitter: ChainEventEmitter, checkpointCachedState: CachedBeaconState): void {
  const config = checkpointCachedState.config;
  const slot = checkpointCachedState.slot;
  assert.true(slot % config.params.SLOTS_PER_EPOCH === 0, "Checkpoint state slot must be first in an epoch");
  const blockHeader = config.types.BeaconBlockHeader.clone(checkpointCachedState.latestBlockHeader);
  if (config.types.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = checkpointCachedState.getTreeBackedState().hashTreeRoot();
  }
  emitter.emit(
    ChainEvent.checkpoint,
    {
      root: config.types.BeaconBlockHeader.hashTreeRoot(blockHeader),
      epoch: computeEpochAtSlot(config, slot),
    },
    checkpointCachedState
  );
}

/**
 * Starting at `stateCtx.slot`,
 * process slots forward towards `slot`,
 * emitting "checkpoint" events after every epoch processed.
 *
 * Stops processing after no more full epochs can be processed.
 */
export async function processSlotsToNearestCheckpoint(
  emitter: ChainEventEmitter,
  preState: CachedBeaconState,
  slot: Slot
): Promise<CachedBeaconState> {
  const config = preState.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const preSlot = preState.slot;
  const postSlot = slot;
  const preEpoch = computeEpochAtSlot(config, preSlot);
  const postState = preState.clone();
  for (
    let nextEpochSlot = computeStartSlotAtEpoch(config, preEpoch + 1);
    nextEpochSlot <= postSlot;
    nextEpochSlot += SLOTS_PER_EPOCH
  ) {
    processSlots(postState, nextEpochSlot);
    emitCheckpointEvent(emitter, postState.clone());
    // this avoids keeping our node busy processing blocks
    await sleep(0);
  }
  return postState;
}

/**
 * Starting at `stateCtx.slot`,
 * process slots forward towards `slot`,
 * emitting "checkpoint" events after every epoch processed.
 */
export async function processSlotsByCheckpoint(
  emitter: ChainEventEmitter,
  preState: CachedBeaconState,
  slot: Slot
): Promise<CachedBeaconState> {
  const postState = await processSlotsToNearestCheckpoint(emitter, preState, slot);
  if (postState.slot < slot) {
    processSlots(postState, slot);
  }
  return postState;
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

export function emitBlockEvent(emitter: ChainEventEmitter, job: IBlockJob, postCtx: CachedBeaconState): void {
  emitter.emit(ChainEvent.block, job.signedBlock, postCtx, job);
}

export async function runStateTransition(
  emitter: ChainEventEmitter,
  forkChoice: IForkChoice,
  db: IBeaconDb,
  preState: CachedBeaconState,
  job: IBlockJob
): Promise<CachedBeaconState> {
  const config = preState.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const postSlot = job.signedBlock.message.slot;

  // if block is trusted don't verify proposer or op signature
  const postState = fastStateTransition(preState, job.signedBlock, {
    verifyStateRoot: true,
    verifyProposer: !job.validSignatures && !job.validProposerSignature,
    verifySignatures: !job.validSignatures,
  });

  const oldHead = forkChoice.getHead();

  // current justified checkpoint should be prev epoch or current epoch if it's just updated
  // it should always have epochBalances there bc it's a checkpoint state, ie got through processEpoch
  const justifiedBalances: Gwei[] = [];
  if (postState.currentJustifiedCheckpoint.epoch > forkChoice.getJustifiedCheckpoint().epoch) {
    const justifiedStateContext = await db.checkpointStateCache.get(postState.currentJustifiedCheckpoint);
    const justifiedEpoch = justifiedStateContext?.currentShuffling.epoch;
    justifiedStateContext?.flatValidators().readOnlyForEach((v) => {
      justifiedBalances.push(isActiveIFlatValidator(v, justifiedEpoch!) ? v.effectiveBalance : BigInt(0));
    });
  }
  forkChoice.onBlock(job.signedBlock.message, postState.getOriginalState(), justifiedBalances);

  if (postSlot % SLOTS_PER_EPOCH === 0) {
    emitCheckpointEvent(emitter, postState);
  }

  emitBlockEvent(emitter, job, postState);
  emitForkChoiceHeadEvents(emitter, forkChoice, forkChoice.getHead(), oldHead);

  // this avoids keeping our node busy processing blocks
  await sleep(0);
  return postState;
}
