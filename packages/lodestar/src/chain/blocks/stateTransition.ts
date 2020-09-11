import {Slot} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {
  ZERO_HASH,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  fastStateTransition,
} from "@chainsafe/lodestar-beacon-state-transition";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";

import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";
import {ChainEventEmitter} from "../emitter";
import {ForkChoice} from "../forkChoice";
import {IBlockProcessJob} from "../interface";

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
    "checkpoint",
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
): Promise<ITreeStateContext> {
  const config = stateCtx.epochCtx.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const preSlot = stateCtx.state.slot;
  const postSlot = slot;
  const preEpoch = computeEpochAtSlot(config, preSlot);
  let postCtx = cloneStateCtx(stateCtx);
  for (
    let nextEpochSlot = computeStartSlotAtEpoch(config, preEpoch + 1);
    nextEpochSlot <= postSlot;
    nextEpochSlot += SLOTS_PER_EPOCH
  ) {
    processSlots(postCtx.epochCtx, postCtx.state, nextEpochSlot);
    emitCheckpointEvent(emitter, postCtx);
    postCtx = cloneStateCtx(postCtx);
  }
  return postCtx;
}

export async function runStateTransition(
  emitter: ChainEventEmitter,
  forkChoice: ForkChoice,
  stateContext: ITreeStateContext,
  job: IBlockProcessJob
): Promise<ITreeStateContext> {
  const config = stateContext.epochCtx.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const postSlot = job.signedBlock.message.slot;
  const checkpointStateContext = await processSlotsToNearestCheckpoint(emitter, stateContext, postSlot - 1);
  // if block is trusted don't verify proposer or op signature
  const postStateContext = fastStateTransition(checkpointStateContext, job.signedBlock, {
    verifyStateRoot: true,
    verifyProposer: !job.trusted,
    verifySignatures: !job.trusted,
  }) as ITreeStateContext;
  forkChoice.onBlock(job.signedBlock.message, postStateContext.state);
  if (postSlot % SLOTS_PER_EPOCH === 0) {
    emitCheckpointEvent(emitter, postStateContext);
  }
  return postStateContext;
}
