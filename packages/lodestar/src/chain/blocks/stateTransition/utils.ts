import {ITreeStateContext, LodestarEpochContext} from "../../../db/api/beacon/stateContextCache";
import {ChainEventEmitter} from "../..";
import {Slot, BeaconState} from "@chainsafe/lodestar-types";
import {
  IStateContext,
  computeStartSlotAtEpoch,
  computeEpochAtSlot,
  toIStateContext,
  lightclient,
} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {emitCheckpointEvent} from "./events";
import {sleep} from "@chainsafe/lodestar-utils";
import {StateTransitionEpochContext} from "../../../../../lodestar-beacon-state-transition/lib/phase0/fast/util/epochContext";

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
 */
export async function processSlotsByCheckpoint(
  emitter: ChainEventEmitter,
  stateCtx: ITreeStateContext,
  slot: Slot
): Promise<ITreeStateContext> {
  let postCtx = await processSlotsToNearestCheckpoint(emitter, stateCtx, slot);
  if (postCtx.state.slot < slot) {
    processSlots(postCtx.epochCtx, postCtx.state, slot);
    postCtx = toTreeStateContext(toIStateContext(postCtx.epochCtx, postCtx.state));
  }
  return postCtx;
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
    postCtx = toTreeStateContext(toIStateContext(postCtx.epochCtx, postCtx.state));
    emitCheckpointEvent(emitter, postCtx);
    postCtx = cloneStateCtx(postCtx);
    // this avoids keeping our node busy processing blocks
    await sleep(0);
  }
  return postCtx;
}

/**
 * Pull necessary data from epochProcess of exchange interface IStateContext
 * and transform to lodestar ITreeStateContext.
 * Make sure no epochProcess stays in ITreeStateContext.
 */
export function toTreeStateContext(stateCtx: IStateContext): ITreeStateContext {
  const treeStateCtx: ITreeStateContext = {
    state: stateCtx.state as TreeBacked<BeaconState>,
    epochCtx: new LodestarEpochContext(undefined, stateCtx.epochCtx),
  };

  if (stateCtx.epochProcess) {
    treeStateCtx.epochCtx.epochBalances = stateCtx.epochProcess.statuses.map((s) =>
      s.active ? s.validator.effectiveBalance : BigInt(0)
    );
  }

  return treeStateCtx;
}

function processSlots<TState extends BeaconState = BeaconState>(
  epochCtx: StateTransitionEpochContext,
  state: TState,
  slot: Slot
): TState {
  if (state.slot >= epochCtx.config.params.lightclient.LIGHTCLIENT_PATCH_FORK_SLOT) {
    return lightclient.pro;
  }
}
