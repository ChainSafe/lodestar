import {UPDATE_TIMEOUT} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {LightClientStore} from "../types.js";
import {applyLightClientUpdate} from "./applyLightClientUpdate.js";

export function processLightClientStoreForceUpdate(store: LightClientStore, currentSlot: Slot): void {
  if (currentSlot > store.finalizedHeader.slot + UPDATE_TIMEOUT && store.bestValidUpdate !== null) {
    // Forced best update when the update timeout has elapsed.
    // Because the apply logic waits for `finalized_header.slot` to indicate sync committee finality,
    // the `attested_header` may be treated as `finalized_header` in extended periods of non-finality
    // to guarantee progression into later sync committee periods according to `is_better_update`.
    if (store.bestValidUpdate.finalizedHeader.slot <= store.finalizedHeader.slot) {
      store.bestValidUpdate.finalizedHeader = store.bestValidUpdate.attestedHeader;
    }
    applyLightClientUpdate(store, store.bestValidUpdate);
    store.bestValidUpdate = null;
  }
}
