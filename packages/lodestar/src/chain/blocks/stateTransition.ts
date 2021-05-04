import {byteArrayEquals} from "@chainsafe/ssz";
import {allForks, Gwei, Slot} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  fast,
  phase0,
  getEffectiveBalances,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ZERO_HASH} from "../../constants";
import {CheckpointStateCache} from "../stateCache";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IBlockJob} from "../interface";
import {sleep} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../metrics";

/**
 * Starting at `state.slot`,
 * process slots forward towards `slot`,
 * emitting "checkpoint" events after every epoch processed.
 */
export async function processSlotsByCheckpoint(
  {emitter, metrics}: {emitter: ChainEventEmitter; metrics: IMetrics | null},
  preState: CachedBeaconState<allForks.BeaconState>,
  slot: Slot
): Promise<CachedBeaconState<allForks.BeaconState>> {
  const postState = await processSlotsToNearestCheckpoint({emitter, metrics}, preState, slot);
  if (postState.slot < slot) {
    phase0.fast.processSlots(postState as CachedBeaconState<phase0.BeaconState>, slot, metrics);
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
  {emitter, metrics}: {emitter: ChainEventEmitter; metrics: IMetrics | null},
  preState: CachedBeaconState<allForks.BeaconState>,
  slot: Slot
): Promise<CachedBeaconState<allForks.BeaconState>> {
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
    phase0.fast.processSlots(postState as CachedBeaconState<phase0.BeaconState>, nextEpochSlot, metrics);
    emitCheckpointEvent(emitter, postState.clone());
    // this avoids keeping our node busy processing blocks
    await sleep(0);
  }
  return postState;
}

export async function runStateTransition(
  {emitter, forkChoice, metrics}: {emitter: ChainEventEmitter; forkChoice: IForkChoice; metrics: IMetrics | null},
  checkpointStateCache: CheckpointStateCache,
  preState: CachedBeaconState<allForks.BeaconState>,
  job: IBlockJob
): Promise<CachedBeaconState<allForks.BeaconState>> {
  const config = preState.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const postSlot = job.signedBlock.message.slot;

  // if block is trusted don't verify proposer or op signature
  const postState = fast.fastStateTransition(
    preState,
    job.signedBlock,
    {
      verifyStateRoot: true,
      verifyProposer: !job.validSignatures && !job.validProposerSignature,
      verifySignatures: !job.validSignatures,
    },
    metrics
  );

  const oldHead = forkChoice.getHead();

  // current justified checkpoint should be prev epoch or current epoch if it's just updated
  // it should always have epochBalances there bc it's a checkpoint state, ie got through processEpoch
  let justifiedBalances: Gwei[] = [];
  if (postState.currentJustifiedCheckpoint.epoch > forkChoice.getJustifiedCheckpoint().epoch) {
    const justifiedState = checkpointStateCache.get(postState.currentJustifiedCheckpoint);
    justifiedBalances = getEffectiveBalances(justifiedState!);
  }
  forkChoice.onBlock(job.signedBlock.message, postState, justifiedBalances);

  if (postSlot % SLOTS_PER_EPOCH === 0) {
    emitCheckpointEvent(emitter, postState);
  }

  emitBlockEvent(emitter, job, postState);
  emitForkChoiceHeadEvents(emitter, forkChoice, forkChoice.getHead(), oldHead);

  return postState;
}

/**
 * Emits a properly formed "checkpoint" event, given a checkpoint state context
 *
 * This will throw an error if the checkpoint state is not a valid checkpoint state, eg: NOT the first slot in an epoch.
 */
function emitCheckpointEvent(
  emitter: ChainEventEmitter,
  checkpointState: CachedBeaconState<allForks.BeaconState>
): void {
  const config = checkpointState.config;
  const slot = checkpointState.slot;
  assert.true(slot % config.params.SLOTS_PER_EPOCH === 0, "Checkpoint state slot must be first in an epoch");
  const blockHeader = config.types.phase0.BeaconBlockHeader.clone(checkpointState.latestBlockHeader);
  if (config.types.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = config.getTypes(slot).BeaconState.hashTreeRoot(checkpointState);
  }
  emitter.emit(
    ChainEvent.checkpoint,
    {
      root: config.types.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader),
      epoch: computeEpochAtSlot(config, slot),
    },
    checkpointState
  );
}

function emitForkChoiceHeadEvents(
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

function emitBlockEvent(
  emitter: ChainEventEmitter,
  job: IBlockJob,
  postState: CachedBeaconState<allForks.BeaconState>
): void {
  emitter.emit(ChainEvent.block, job.signedBlock, postState, job);
}
