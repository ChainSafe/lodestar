import {phase0, Slot} from "@chainsafe/lodestar-types";

import {processEpoch} from "../epoch";
import {processSlot} from "./processSlot";
import {CachedBeaconState, rotateEpochs} from "../util";

export {processSlot};

export function processSlots(state: CachedBeaconState<phase0.BeaconState>, slot: Slot): void {
  if (!(state.slot < slot)) {
    throw new Error("State slot must transition to a future slot: " + `stateSlot=${state.slot} slot=${slot}`);
  }
  while (state.slot < slot) {
    processSlot(state);
    // process epoch on the start slot of the next epoch
    if ((state.slot + 1) % state.config.params.SLOTS_PER_EPOCH === 0) {
      processEpoch(state);
      state.slot += 1;
      rotateEpochs(state.epochCtx, state, state.validators);
    } else {
      state.slot += 1;
    }
  }
}
