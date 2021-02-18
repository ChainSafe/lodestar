import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  phase0,
  IStateContext,
} from "@chainsafe/lodestar-beacon-state-transition";
import {Slot} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {ChainEventEmitter, ITreeStateContext} from "../..";
import {emitCheckpointEvent} from "./events";

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
