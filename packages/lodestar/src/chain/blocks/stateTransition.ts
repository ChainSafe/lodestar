import {toHexString} from "@chainsafe/ssz";
import {Slot} from "@chainsafe/lodestar-types";
import {assert, ILogger} from "@chainsafe/lodestar-utils";
import {
  ZERO_HASH,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  fastStateTransition,
} from "@chainsafe/lodestar-beacon-state-transition";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";
import {ChainEventEmitter} from "../emitter";
import {IBlockProcessJob} from "../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db";

// TODO remove after state regenerator exists
export async function getPreState(
  config: IBeaconConfig,
  db: IBeaconDb,
  forkChoice: IForkChoice,
  logger: ILogger,
  job: IBlockProcessJob
): Promise<ITreeStateContext> {
  const parentBlock = forkChoice.getBlock(job.signedBlock.message.parentRoot.valueOf() as Uint8Array);
  const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
  if (!parentBlock) {
    logger.debug(
      `Block(${toHexString(blockRoot)}) at slot ${job.signedBlock.message.slot}` +
        ` is missing parent block (${toHexString(job.signedBlock.message.parentRoot)}).`
    );
    throw new Error("Missing parent");
  }
  let stateCtx = await db.stateCache.get(parentBlock.stateRoot);
  if (!stateCtx) {
    logger.verbose("Missing state in cache", {
      slot: job.signedBlock.message.slot,
      blockRoot: toHexString(blockRoot),
      parentRoot: toHexString(parentBlock.blockRoot),
    });
    const nearestEpoch = computeEpochAtSlot(config, job.signedBlock.message.slot - 1);
    // when we restart from a skipped slot, we only have checkpoint state, not state
    // we always do processSlotsToNearestCheckpoint when running state transition so this is reasonable
    stateCtx = await db.checkpointStateCache.getLatest({
      root: parentBlock.blockRoot,
      epoch: nearestEpoch,
    });
    if (!stateCtx) {
      logger.error("Missing state in cache", {
        slot: job.signedBlock.message.slot,
        blockRoot: toHexString(blockRoot),
        parentRoot: toHexString(parentBlock.blockRoot),
      });
      throw new Error("Missing state in cache");
    }
  }
  return stateCtx;
}

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
  forkChoice: IForkChoice,
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
