import {altair} from "@lodestar/types";
import {LightClientStore} from "../types.js";
import {computeSyncPeriodAtSlot, deserializeSyncCommittee} from "../utils/index.js";
import {isNextSyncCommitteeKnown, isZeroedSyncCommittee} from "./utils.js";

export function applyLightClientUpdate(store: LightClientStore, update: altair.LightClientUpdate): void {
  const storePeriod = computeSyncPeriodAtSlot(store.finalizedHeader.slot);
  const updateFinalizedPeriod = computeSyncPeriodAtSlot(update.finalizedHeader.slot);
  if (!isNextSyncCommitteeKnown(store)) {
    if (updateFinalizedPeriod != storePeriod) {
      throw Error("updateFinalizedPeriod must equal storePeriod");
    }
    // TODO: Review logic, should throw if update.nextSyncCommittee is zero
    if (!isZeroedSyncCommittee(update.nextSyncCommittee)) {
      store.nextSyncCommittee = deserializeSyncCommittee(update.nextSyncCommittee);
    }
  } else if (updateFinalizedPeriod == storePeriod + 1) {
    if (!store.nextSyncCommittee) {
      throw Error("nextSyncCommittee not defineds");
    }

    store.currentSyncCommittee = store.nextSyncCommittee;
    // TODO: Review logic, should throw if update.nextSyncCommittee is zero
    if (!isZeroedSyncCommittee(update.nextSyncCommittee)) {
      store.nextSyncCommittee = deserializeSyncCommittee(update.nextSyncCommittee);
    } else {
      store.nextSyncCommittee = null;
    }
    store.previousMaxActiveParticipants = store.currentMaxActiveParticipants;
    store.currentMaxActiveParticipants = 0;
  }

  if (update.finalizedHeader.slot > store.finalizedHeader.slot) {
    store.finalizedHeader = update.finalizedHeader;
    if (store.finalizedHeader.slot > store.optimisticHeader.slot) {
      store.optimisticHeader = store.finalizedHeader;
    }
  }
}
