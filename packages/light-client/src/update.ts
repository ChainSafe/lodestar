import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LIGHT_CLIENT_UPDATE_TIMEOUT} from "@chainsafe/lodestar-params";
import {altair, Slot} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {List} from "@chainsafe/ssz";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {validateLightClientUpdate} from "./validation";
import {sumBits} from "./utils";

/**
 * A light client maintains its state in a store object of type LightClientStore and receives update objects of type LightClientUpdate.
 * Every update triggers process_light_client_update(store, update, current_slot) where current_slot is the current slot based on some local clock.
 * Spec v1.0.1
 */
export function processLightClientUpdate(
  config: IBeaconConfig,
  store: altair.LightClientStore,
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
    store.validUpdates = ([] as altair.LightClientUpdate[]) as List<altair.LightClientUpdate>;
  }

  // Forced best update when the update timeout has elapsed
  else if (currentSlot > store.snapshot.header.slot + LIGHT_CLIENT_UPDATE_TIMEOUT) {
    const bestUpdate = getBestUpdate(Array.from(store.validUpdates));
    if (bestUpdate) {
      applyLightClientUpdate(config, store.snapshot, bestUpdate);
      store.validUpdates = ([] as altair.LightClientUpdate[]) as List<altair.LightClientUpdate>;
    }
  }
}

/**
 * Spec v1.0.1
 */
export function applyLightClientUpdate(
  config: IBeaconConfig,
  snapshot: altair.LightClientSnapshot,
  update: altair.LightClientUpdate
): void {
  const {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} = config.params;
  const snapshotPeriod = intDiv(computeEpochAtSlot(config, snapshot.header.slot), EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  const updatePeriod = intDiv(computeEpochAtSlot(config, update.header.slot), EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  if (updatePeriod === snapshotPeriod + 1) {
    snapshot.currentSyncCommittee = snapshot.nextSyncCommittee;
    snapshot.nextSyncCommittee = update.nextSyncCommittee;
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
