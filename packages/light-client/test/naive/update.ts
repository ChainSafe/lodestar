import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {altair, Slot} from "@chainsafe/lodestar-types";
import {LightClientSnapshotFast, LightClientStoreFast} from "../../src/types.js";
import {assertValidLightClientUpdate} from "../../src/validation.js";
import {deserializeSyncCommittee, isEmptyHeader, sumBits} from "../../src/utils/utils.js";
import {computeSyncPeriodAtSlot} from "../../src/utils/clock.js";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

//
// A lightclient has two types of syncing:
// - Committee sync: Retrieve all SyncCommittee pubkeys for a given period.
//   To do that safely the lightclient has to retrieve the syncCommittee of each period
//   between its latest trusted and up to the target. The lightclient doesn't care about the slot of
//   the updates as long as there's at least one per period.
//
//   GET /eth/v1/lightclient/best-update/:periods
//
//   The definition of "best-update" is vague so nodes have the freedom to optimize what to store.
//   A possible strategy is to persist the latest LightclientUpdate that has the most bits within a period.
//
//   How to start from genesis or a known state root? The lightclient will request the node a proof of
//   the NextSyncCommittee at the trusted state root and then sync from computePeriodAtSlot(trustedSlot)
//
// - Head sync: To query state beyond the latest finalized checkpoint, and for a known SyncCommittee that period N
//   the lightclient can request headers signed by a known SyncCommittee.
//
//   GET /eth/v1/lightclient/latest-header/:period
//   {
//     header: phase0.BeaconBlockHeader;
//     syncCommitteeBits: BitVector;
//     syncCommitteeSignature: primitive.BLSSignature;
//     forkVersion: primitive.Version;
//   }
//
//   Nodes should keep the latest header at a specific period, or even just the latest period and 404 the rest.
//   All past data can be then retrieved with proofs, there no point in serving old updates.

// Sync process for lightclient:
// 1. Start from a trusted state root. If the lightclient has an existing store jump to 3
// 2. Request a proof for currentSyncCommittee and nextSyncCommittee at the trusted state root
// 3. Compute the list of sequential periods between the trusted state root and the clock = periods.
//    GET /eth/v1/lightclient/best-update/{periods}
// 4. Verify and apply each update sequentially.
// 5. At the end of each clock period jump to 3 and repeat

/**
 * A light client maintains its state in a store object of type LightClientStore and receives update objects of type LightClientUpdate.
 * Every update triggers process_light_client_update(store, update, current_slot) where current_slot is the current slot based on some local clock.
 * Spec v1.0.1
 */
export function processLightClientUpdate(
  config: IBeaconConfig,
  store: LightClientStoreFast,
  update: altair.LightClientUpdate,
  currentSlot: Slot
): void {
  // TODO - TEMP
  const syncCommittee = store.snapshot.nextSyncCommittee;
  assertValidLightClientUpdate(config, syncCommittee, update);

  const syncPeriod = computeSyncPeriodAtSlot(update.attestedHeader.slot);
  const prevBestUpdate = store.bestUpdates.get(syncPeriod);
  if (!prevBestUpdate || isBetterUpdate(prevBestUpdate, update)) {
    store.bestUpdates.set(syncPeriod, update);
  }

  const updateTimeout = SLOTS_PER_EPOCH * EPOCHS_PER_SYNC_COMMITTEE_PERIOD;

  // Apply update if (1) 2/3 quorum is reached and (2) we have a finality proof.
  // Note that (2) means that the current light client design needs finality.
  // It may be changed to re-organizable light client design. See the on-going issue https://github.com/ethereum/consensus-specs/issues/2315.
  if (
    sumBits(update.syncAggregate.syncCommitteeBits) * 3 >= update.syncAggregate.syncCommitteeBits.bitLen * 2 &&
    !isEmptyHeader(update.finalizedHeader)
  ) {
    applyLightClientUpdate(store.snapshot, update);
    store.bestUpdates.delete(syncPeriod);
  }

  // Forced best update when the update timeout has elapsed
  else if (currentSlot > store.snapshot.header.slot + updateTimeout) {
    const prevSyncPeriod = computeSyncPeriodAtSlot(store.snapshot.header.slot);
    const bestUpdate = store.bestUpdates.get(prevSyncPeriod);
    if (bestUpdate) {
      applyLightClientUpdate(store.snapshot, bestUpdate);
      store.bestUpdates.delete(prevSyncPeriod);
    }
  }
}

/**
 * Spec v1.0.1
 */
export function applyLightClientUpdate(snapshot: LightClientSnapshotFast, update: altair.LightClientUpdate): void {
  const snapshotPeriod = computeSyncPeriodAtSlot(snapshot.header.slot);
  const updatePeriod = computeSyncPeriodAtSlot(update.attestedHeader.slot);
  if (updatePeriod < snapshotPeriod) {
    throw Error("Cannot rollback sync period");
  }
  if (updatePeriod === snapshotPeriod + 1) {
    snapshot.currentSyncCommittee = snapshot.nextSyncCommittee;
    snapshot.nextSyncCommittee = deserializeSyncCommittee(update.nextSyncCommittee);
  }
  snapshot.header = update.attestedHeader;
}

/**
 * Returns the update with more bits. On ties, newUpdate is the better
 *
 * Spec v1.0.1
 * ```python
 * max(store.valid_updates, key=lambda update: sum(update.sync_committee_bits)))
 * ```
 */
export function isBetterUpdate(prevUpdate: altair.LightClientUpdate, newUpdate: altair.LightClientUpdate): boolean {
  return sumBits(newUpdate.syncAggregate.syncCommitteeBits) >= sumBits(prevUpdate.syncAggregate.syncCommitteeBits);
}
