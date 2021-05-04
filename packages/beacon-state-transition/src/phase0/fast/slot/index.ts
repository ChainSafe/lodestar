import {allForks, phase0, Slot} from "@chainsafe/lodestar-types";

import {processEpoch} from "../epoch";
import {processSlot} from "./processSlot";
import {CachedBeaconState, rotateEpochs} from "../../../fast/util";
import {assert} from "@chainsafe/lodestar-utils";

export {processSlot};

export function processSlots(state: CachedBeaconState<phase0.BeaconState>, slot: Slot): void {
  assert.lte(state.slot, slot, `State slot ${state.slot} must transition to a future slot ${slot}`);
  while (state.slot < slot) {
    processSlot(state);
    // process epoch on the start slot of the next epoch
    if ((state.slot + 1) % state.config.params.SLOTS_PER_EPOCH === 0) {
      processEpoch(state);
      state.slot += 1;
      rotateEpochs(state.epochCtx, state as CachedBeaconState<allForks.BeaconState>, state.validators);
    } else {
      state.slot += 1;
    }
  }
}
