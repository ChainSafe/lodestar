import {Slot} from "@chainsafe/lodestar-types";

import {processEpoch} from "../epoch";
import {CachedBeaconState} from "../util/cachedBeaconState";
import {processSlot} from "./processSlot";

export {processSlot};

export function processSlots(cachedState: CachedBeaconState, slot: Slot): void {
  if (!(cachedState.slot < slot)) {
    throw new Error("State slot must transition to a future slot: " + `stateSlot=${cachedState.slot} slot=${slot}`);
  }
  while (cachedState.slot < slot) {
    processSlot(cachedState);
    // process epoch on the start slot of the next epoch
    if ((cachedState.slot + 1) % cachedState.config.params.SLOTS_PER_EPOCH === 0) {
      processEpoch(cachedState);
      cachedState.slot += 1;
      cachedState.rotateEpochs();
    } else {
      cachedState.slot += 1;
    }
  }
}
