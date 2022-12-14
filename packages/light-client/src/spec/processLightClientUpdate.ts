import {SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {altair, Slot, SyncPeriod} from "@lodestar/types";
import {computeSyncPeriodAtSlot, deserializeSyncCommittee, sumBits} from "../utils/index.js";
import {isBetterUpdate, LightClientUpdateSummary, toLightClientUpdateSummary} from "./isBetterUpdate.js";
import {ILightClientStore, SyncCommitteeFast} from "./store.js";
import {getSafetyThreshold, isSyncCommitteeUpdate} from "./utils.js";
import {validateLightClientUpdate} from "./validateLightClientUpdate.js";

export interface ProcessUpdateOpts {
  allowForcedUpdates?: boolean;
  updateHeadersOnForcedUpdate?: boolean;
}

export function processLightClientUpdate(
  store: ILightClientStore,
  currentSlot: Slot,
  opts: ProcessUpdateOpts,
  update: altair.LightClientUpdate
): void {
  if (update.signatureSlot > currentSlot) {
    throw Error(`update slot ${update.signatureSlot} must not be in the future, current slot ${currentSlot}`);
  }

  const updateSignaturePeriod = computeSyncPeriodAtSlot(update.signatureSlot);
  // TODO: Consider attempting to retrieve LightClientUpdate from transport if missing
  // Note: store.getSyncCommitteeAtPeriod() may advance store
  const syncCommittee = getSyncCommitteeAtPeriod(store, updateSignaturePeriod, opts);

  validateLightClientUpdate(store, update, syncCommittee);

  // Track the maximum number of active participants in the committee signatures
  const syncCommitteeTrueBits = sumBits(update.syncAggregate.syncCommitteeBits);
  store.setActiveParticipants(updateSignaturePeriod, syncCommitteeTrueBits);

  // Update the optimistic header
  if (
    syncCommitteeTrueBits > getSafetyThreshold(store.getMaxActiveParticipants(updateSignaturePeriod)) &&
    update.attestedHeader.slot > store.optimisticHeader.slot
  ) {
    store.optimisticHeader = update.attestedHeader;
  }

  // Update finalized header
  if (
    syncCommitteeTrueBits * 3 >= SYNC_COMMITTEE_SIZE * 2 &&
    update.finalizedHeader.slot > store.finalizedHeader.slot
  ) {
    store.finalizedHeader = update.finalizedHeader;
    if (store.finalizedHeader.slot > store.optimisticHeader.slot) {
      store.optimisticHeader = store.finalizedHeader;
    }
  }

  if (isSyncCommitteeUpdate(update)) {
    // Update the best update in case we have to force-update to it if the timeout elapses
    const bestValidUpdate = store.bestValidUpdates.get(updateSignaturePeriod);
    const updateSummary = toLightClientUpdateSummary(update);
    if (!bestValidUpdate || isBetterUpdate(updateSummary, bestValidUpdate.summary)) {
      store.bestValidUpdates.set(updateSignaturePeriod, {update, summary: updateSummary});
    }

    // Note: defer update next sync committee to a future getSyncCommitteeAtPeriod() call
  }
}

export function getSyncCommitteeAtPeriod(
  store: ILightClientStore,
  period: SyncPeriod,
  opts: ProcessUpdateOpts
): SyncCommitteeFast {
  const syncCommittee = store.syncCommittees.get(period);
  if (syncCommittee) {
    return syncCommittee;
  }

  const bestValidUpdate = store.bestValidUpdates.get(period - 1);
  if (bestValidUpdate) {
    if (isSafeLightClientUpdate(bestValidUpdate.summary) || opts.allowForcedUpdates) {
      const {update} = bestValidUpdate;
      const syncCommittee = deserializeSyncCommittee(update.nextSyncCommittee);
      store.syncCommittees.set(period, syncCommittee);
      store.bestValidUpdates.delete(period - 1);

      if (opts.updateHeadersOnForcedUpdate) {
        // From https://github.com/ethereum/consensus-specs/blob/a57e15636013eeba3610ff3ade41781dba1bb0cd/specs/altair/light-client/sync-protocol.md?plain=1#L403
        if (update.finalizedHeader.slot <= store.finalizedHeader.slot) {
          update.finalizedHeader = update.attestedHeader;
        }

        // From https://github.com/ethereum/consensus-specs/blob/a57e15636013eeba3610ff3ade41781dba1bb0cd/specs/altair/light-client/sync-protocol.md?plain=1#L374
        if (update.finalizedHeader.slot > store.finalizedHeader.slot) {
          store.finalizedHeader = update.finalizedHeader;
        }
        if (store.finalizedHeader.slot > store.optimisticHeader.slot) {
          store.optimisticHeader = store.finalizedHeader;
        }
      }

      return syncCommittee;
    }
  }

  const availableSyncCommittees = Array.from(store.syncCommittees.keys());
  const availableBestValidUpdates = Array.from(store.bestValidUpdates.keys());
  throw Error(
    `No SyncCommittee for period ${period}` +
      ` available syncCommittees ${JSON.stringify(availableSyncCommittees)}` +
      ` available bestValidUpdates ${JSON.stringify(availableBestValidUpdates)}`
  );
}

export function isSafeLightClientUpdate(update: LightClientUpdateSummary): boolean {
  return (
    update.activeParticipants * 3 >= SYNC_COMMITTEE_SIZE * 2 && update.isFinalityUpdate && update.isSyncCommitteeUpdate
  );
}
