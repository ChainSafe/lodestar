import {IBeaconConfig} from "@lodestar/config";
import {SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {altair, Slot} from "@lodestar/types";
import {LightClientStore} from "../types.js";
import {computeSyncPeriodAtSlot, sumBits} from "../utils/index.js";
import {applyLightClientUpdate} from "./applyLightClientUpdate.js";
import {isBetterUpdate, toLightClientUpdateSummary} from "./isBetterUpdate.js";
import {getSafetyThreshold, isFinalityUpdate, isNextSyncCommitteeKnown, isSyncCommitteeUpdate} from "./utils.js";
import {validateLightClientUpdate} from "./validateLightClientUpdate.js";

export function processLightClientUpdate(
  config: IBeaconConfig,
  store: LightClientStore,
  update: altair.LightClientUpdate,
  currentSlot: Slot
): void {
  validateLightClientUpdate(config, store, update, currentSlot);

  // Update the best update in case we have to force-update to it if the timeout elapses
  if (
    store.bestValidUpdate === null ||
    isBetterUpdate(toLightClientUpdateSummary(update), toLightClientUpdateSummary(store.bestValidUpdate))
  ) {
    store.bestValidUpdate = update;
  }

  // Track the maximum number of active participants in the committee signatures
  const syncCommitteeTrueBits = sumBits(update.syncAggregate.syncCommitteeBits);
  store.currentMaxActiveParticipants = Math.max(store.currentMaxActiveParticipants, syncCommitteeTrueBits);

  // Update the optimistic header
  if (syncCommitteeTrueBits > getSafetyThreshold(store) && update.attestedHeader.slot > store.optimisticHeader.slot) {
    store.optimisticHeader = update.attestedHeader;
  }

  // Update finalized header
  const updateHasFinalizedNextSyncCommittee =
    !isNextSyncCommitteeKnown(store) &&
    isSyncCommitteeUpdate(update) &&
    isFinalityUpdate(update) &&
    computeSyncPeriodAtSlot(update.finalizedHeader.slot) == computeSyncPeriodAtSlot(update.attestedHeader.slot);
  if (
    syncCommitteeTrueBits * 3 >= SYNC_COMMITTEE_SIZE * 2 &&
    (update.finalizedHeader.slot > store.finalizedHeader.slot || updateHasFinalizedNextSyncCommittee)
  ) {
    // Normal update through 2/3 threshold
    applyLightClientUpdate(store, update);
    store.bestValidUpdate = null;
  }
}
