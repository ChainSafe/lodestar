import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LIGHT_CLIENT_UPDATE_TIMEOUT} from "@chainsafe/lodestar-params";
import {altair, Slot} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {ArrayLike, List} from "@chainsafe/ssz";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {validateAltairUpdate} from "./validation";

/**
 * Spec v1.0.1
 */
export function applyLightClientUpdate(
  config: IBeaconConfig,
  snapshot: altair.AltairSnapshot,
  update: altair.AltairUpdate
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
 * Spec v1.0.1
 */
export function processAltairUpdate(
  config: IBeaconConfig,
  store: altair.AltairStore,
  update: altair.AltairUpdate,
  currentSlot: Slot
): void {
  validateAltairUpdate(config, store.snapshot, update);
  store.validUpdates.push(update);

  // Apply update if (1) 2/3 quorum is reached and (2) we have a finality proof.
  // Note that (2) means that the current light client design needs finality.
  // It may be changed to re-organizable light client design. See the on-going issue eth2.0-specs#2182.
  if (
    sumBits(update.syncCommitteeBits) * 3 > update.syncCommitteeBits.length * 2 &&
    !config.types.altair.BeaconBlockHeader.equals(update.header, update.finalityHeader)
  ) {
    applyLightClientUpdate(config, store.snapshot, update);
    store.validUpdates = ([] as altair.AltairUpdate[]) as List<altair.AltairUpdate>;
  }

  // Forced best update when the update timeout has elapsed
  else if (currentSlot > store.snapshot.header.slot + LIGHT_CLIENT_UPDATE_TIMEOUT) {
    const bestUpdate = getBestUpdate(Array.from(store.validUpdates));
    if (bestUpdate) {
      applyLightClientUpdate(config, store.snapshot, bestUpdate);
      store.validUpdates = ([] as altair.AltairUpdate[]) as List<altair.AltairUpdate>;
    }
  }
}

/**
 * Return the `altair.AltairUpdate` with the most true syncCommitteeBits
 *
 * Spec v1.0.1
 * ```python
 * max(store.valid_updates, key=lambda update: sum(update.sync_committee_bits)))
 * ```
 */
function getBestUpdate(updates: altair.AltairUpdate[]): altair.AltairUpdate | null {
  return updates.reduce<{update: altair.AltairUpdate | null; sum: number}>(
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

function sumBits(bits: ArrayLike<boolean>): number {
  let sum = 0;
  for (const bit of bits) {
    if (bit) {
      sum++;
    }
  }
  return sum;
}
