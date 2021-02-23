import {Slot} from "@chainsafe/lodestar-types";

import {processEpoch} from "../epoch";
import {processSlot} from "./processSlot";
import {CachedValidatorsBeaconState} from "../util";
import {EpochContext} from "../util";

export {processSlot};

export function processSlots(epochCtx: EpochContext, state: CachedValidatorsBeaconState, slot: Slot): void {
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
  }
}
