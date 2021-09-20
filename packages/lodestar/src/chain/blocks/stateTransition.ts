import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/ssz";
import {Slot, ssz} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  allForks,
  getEffectiveBalances,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice, IProtoBlock} from "@chainsafe/lodestar-fork-choice";

import {ZERO_HASH} from "../../constants";
import {CheckpointStateCache, toCheckpointHex} from "../stateCache";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IBlockJob} from "../interface";
import {sleep} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../metrics";
import {BlockError, BlockErrorCode} from "../errors";

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
      verifyStateRoot: false,
      verifyProposer: !job.validSignatures && !job.validProposerSignature,
      verifySignatures: !job.validSignatures,
    },
    metrics
  );

  const blockStateRoot = job.signedBlock.message.stateRoot;
  if (!ssz.Root.equals(blockStateRoot, postState.tree.root)) {
    throw new BlockError(job.signedBlock, {code: BlockErrorCode.INVALID_STATE_ROOT, preState, postState});
  }

  const oldHead = forkChoice.getHead();

  // TODO: Use regen to get the justified state. Send the block to the forkChoice immediately, and the balances
  // latter in case regen takes too much time.

  // current justified checkpoint should be prev epoch or current epoch if it's just updated
  // it should always have epochBalances there bc it's a checkpoint state, ie got through processEpoch
  let justifiedBalances: number[] = [];
  if (postState.currentJustifiedCheckpoint.epoch > forkChoice.getJustifiedCheckpoint().epoch) {
    const justifiedState = checkpointStateCache.get(toCheckpointHex(postState.currentJustifiedCheckpoint));
    if (!justifiedState) {
      const epoch = postState.currentJustifiedCheckpoint.epoch;
      const root = toHexString(postState.currentJustifiedCheckpoint.root);
      throw Error(`State not available for justified checkpoint ${epoch} ${root}`);
    }
    justifiedBalances = getEffectiveBalances(justifiedState);
  }

  forkChoice.onBlock(job.signedBlock.message, postState, {
    justifiedBalances,
    // TODO: Figure out how to fetch for merge
    powBlock: undefined,
    powBlockParent: undefined,
  });

  if (!job.reprocess) {
    if (postSlot % SLOTS_PER_EPOCH === 0) {
      emitCheckpointEvent(emitter, postState);
    }

    // TODO: Move internal emitter onBlock() code here
    emitter.emit(ChainEvent.block, job.signedBlock, postState, job);

    forkChoice.updateHead();
    emitForkChoiceHeadEvents(emitter, forkChoice, oldHead, metrics);
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
  oldHead: IProtoBlock,
  metrics: IMetrics | null
): void {
  const newHead = forkChoice.getHead();
  if (newHead.blockRoot !== oldHead.blockRoot) {
    // new head
    emitter.emit(ChainEvent.forkChoiceHead, newHead);
    metrics?.forkChoiceChangedHead.inc();

    const distance = forkChoice.getCommonAncestorDistance(oldHead, newHead);
    if (distance !== null) {
      // chain reorg
      emitter.emit(ChainEvent.forkChoiceReorg, newHead, oldHead, distance);
      metrics?.forkChoiceReorg.inc();
    }
  }
}
