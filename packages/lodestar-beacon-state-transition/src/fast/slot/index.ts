import {BeaconState, Slot} from "@chainsafe/lodestar-types";

import {StateTransitionEpochContext} from "../util/epochContext";
import {processEpoch} from "../epoch";
import {processSlot} from "./processSlot";
import {LIGHTCLIENT_PATCH_FORK_SLOT, upgrade as lightclientUpgrade} from "../../lightclient";

export {processSlot};

export function processSlots<TState extends BeaconState = BeaconState>(
  epochCtx: StateTransitionEpochContext,
  state: TState,
  slot: Slot
): TState {
  if (!(state.slot < slot)) {
    throw new Error("State slot must transition to a future slot: " + `stateSlot=${state.slot} slot=${slot}`);
  }
  while (state.slot < slot) {
    processSlot(epochCtx, state);
    // process epoch on the start slot of the next epoch
    if ((state.slot + 1) % epochCtx.config.params.SLOTS_PER_EPOCH === 0) {
      processEpoch(epochCtx, state);
      state.slot += 1;
      epochCtx.rotateEpochs(state);
    } else {
      state.slot += 1;
    }
    if (state.slot >= LIGHTCLIENT_PATCH_FORK_SLOT) {
      state = (lightclientUpgrade(epochCtx.config, state) as unknown) as TState;
    }
  }
  return state;
}
