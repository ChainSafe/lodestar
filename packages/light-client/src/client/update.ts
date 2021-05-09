import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LIGHT_CLIENT_UPDATE_TIMEOUT} from "@chainsafe/lodestar-params";
import {altair, Slot} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {validateLightClientUpdate} from "./validation";
import {deserializePubkeys, sumBits} from "../utils/utils";
import {LightClientSnapshotFast, LightClientStoreFast} from "./types";

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
  currentSlot: Slot,
  genesisValidatorsRoot: altair.Root
): void {
  validateLightClientUpdate(config, store.snapshot, update, genesisValidatorsRoot);
  store.validUpdates.push(update);

  // Apply update if (1) 2/3 quorum is reached and (2) we have a finality proof.
  // Note that (2) means that the current light client design needs finality.
  // It may be changed to re-organizable light client design. See the on-going issue eth2.0-specs#2182.
  if (
    sumBits(update.syncCommitteeBits) * 3 > update.syncCommitteeBits.length * 2 &&
    !config.types.altair.BeaconBlockHeader.equals(update.header, update.finalityHeader)
  ) {
    applyLightClientUpdate(config, store.snapshot, update);
    store.validUpdates = [];
  }

  // Forced best update when the update timeout has elapsed
  else if (currentSlot > store.snapshot.header.slot + LIGHT_CLIENT_UPDATE_TIMEOUT) {
    const bestUpdate = getBestUpdate(Array.from(store.validUpdates));
    if (bestUpdate) {
      applyLightClientUpdate(config, store.snapshot, bestUpdate);
      store.validUpdates = [];
    }
  }
}

/**
 * Spec v1.0.1
 */
export function applyLightClientUpdate(
  config: IBeaconConfig,
  snapshot: LightClientSnapshotFast,
  update: altair.LightClientUpdate
): void {
  const {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} = config.params;
  const snapshotPeriod = intDiv(computeEpochAtSlot(config, snapshot.header.slot), EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  const updatePeriod = intDiv(computeEpochAtSlot(config, update.header.slot), EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  if (updatePeriod === snapshotPeriod + 1) {
    snapshot.currentSyncCommittee = snapshot.nextSyncCommittee;
    snapshot.nextSyncCommittee = {
      pubkeys: deserializePubkeys(update.nextSyncCommittee.pubkeys),
      pubkeyAggregates: deserializePubkeys(update.nextSyncCommittee.pubkeyAggregates),
    };
  }
  snapshot.header = update.header;
}

/**
 * Return the `altair.LightClientUpdate` with the most true syncCommitteeBits
 *
 * Spec v1.0.1
 * ```python
 * max(store.valid_updates, key=lambda update: sum(update.sync_committee_bits)))
 * ```
 */
function getBestUpdate(updates: altair.LightClientUpdate[]): altair.LightClientUpdate | null {
  return updates.reduce<{update: altair.LightClientUpdate | null; sum: number}>(
    (agg, update) => {
      const participantsCount = sumBits(update.syncCommitteeBits);
      if (participantsCount > agg.sum) {
        return {update, sum: participantsCount};
      } else {
        return agg;
      }
    },
    {update: null, sum: 0}
  ).update;
}
