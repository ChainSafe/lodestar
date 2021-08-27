import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {byteArrayEquals, toHexString} from "@chainsafe/ssz";
import {Gwei, Slot, ssz} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  allForks,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ZERO_HASH} from "../../constants";
import {CheckpointStateCache} from "../stateCache";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IBlockJob} from "../interface";
import {sleep} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../metrics";
import {getEffectiveBalances} from "../../util/beaconStateTransition";

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
  let postState = await processSlotsToNearestCheckpoint({emitter, metrics}, preState, slot);
  if (postState.slot < slot) {
    postState = allForks.processSlots(postState, slot, metrics);
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
  const preSlot = preState.slot;
  const postSlot = slot;
  const preEpoch = computeEpochAtSlot(preSlot);
  let postState = preState.clone();
  for (
    let nextEpochSlot = computeStartSlotAtEpoch(preEpoch + 1);
    nextEpochSlot <= postSlot;
    nextEpochSlot += SLOTS_PER_EPOCH
  ) {
    postState = allForks.processSlots(postState, nextEpochSlot, metrics);
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
  const postSlot = job.signedBlock.message.slot;
  const preEpoch = preState.currentShuffling.epoch;
  const postEpoch = computeEpochAtSlot(postSlot);
  // if there're skipped slots at epoch transition, we want to cache all checkpoint states in the middle
  const passCheckpoint = preEpoch < postEpoch && postSlot !== computeStartSlotAtEpoch(postEpoch);
  const state = passCheckpoint
    ? await processSlotsToNearestCheckpoint({emitter, metrics}, preState, postSlot)
    : preState;

  // if block is trusted don't verify proposer or op signature
  const postState = allForks.stateTransition(
    state,
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
    if (!justifiedState) {
      const epoch = postState.currentJustifiedCheckpoint.epoch;
      const root = toHexString(postState.currentJustifiedCheckpoint.root);
      throw Error(`State not available for justified checkpoint ${epoch} ${root}`);
    }
    justifiedBalances = getEffectiveBalances(justifiedState);
  }
  forkChoice.onBlock(job.signedBlock.message, postState, justifiedBalances);

  if (!job.reprocess) {
    if (postSlot % SLOTS_PER_EPOCH === 0) {
      emitCheckpointEvent(emitter, postState);
    }

    emitBlockEvent(emitter, job, postState);
    forkChoice.updateHead();
    emitForkChoiceHeadEvents(emitter, forkChoice, forkChoice.getHead(), oldHead, metrics);
  }

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
  assert.true(slot % SLOTS_PER_EPOCH === 0, "Checkpoint state slot must be first in an epoch");
  const blockHeader = ssz.phase0.BeaconBlockHeader.clone(checkpointState.latestBlockHeader);
  if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = config.getForkTypes(slot).BeaconState.hashTreeRoot(checkpointState);
  }
  emitter.emit(
    ChainEvent.checkpoint,
    {
      root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader),
      epoch: computeEpochAtSlot(slot),
    },
    checkpointState
  );
}

function emitForkChoiceHeadEvents(
  emitter: ChainEventEmitter,
  forkChoice: IForkChoice,
  head: IBlockSummary,
  oldHead: IBlockSummary,
  metrics: IMetrics | null
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
      metrics?.forkChoiceReorg.inc();
    }
    emitter.emit(ChainEvent.forkChoiceHead, head);
    metrics?.forkChoiceChangedHead.inc();
  }
}

function emitBlockEvent(
  emitter: ChainEventEmitter,
  job: IBlockJob,
  postState: CachedBeaconState<allForks.BeaconState>
): void {
  emitter.emit(ChainEvent.block, job.signedBlock, postState, job);
}
