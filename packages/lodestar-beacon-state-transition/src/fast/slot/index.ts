import {BeaconState, Slot} from "@chainsafe/lodestar-types";

import {EpochContext} from "../util";
import {processEpoch} from "../epoch";
import {processSlot} from "./processSlot";


export {
  processSlot,
};

export function processSlots(epochCtx: EpochContext, state: BeaconState, slot: Slot): void {
  if (!(state.slot <= slot)) {
    throw new Error(
      "State slot must transition to a future slot: " +
      `stateSlot=${state.slot} slot=${slot}`
    );
  }
  while (state.slot < slot) {
    processSlot(epochCtx, state);
    // process epoch on the start slot of the next epoch
    if ((state.slot + 1n) % epochCtx.config.params.SLOTS_PER_EPOCH === 0n) {
      processEpoch(epochCtx, state);
      state.slot += 1n;
      epochCtx.rotateEpochs(state);
    } else {
      state.slot += 1n;
    }
  }
}
