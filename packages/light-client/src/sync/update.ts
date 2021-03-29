import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LIGHT_CLIENT_UPDATE_TIMEOUT} from "@chainsafe/lodestar-params";
import {altair, Slot} from "@chainsafe/lodestar-types";
import {assert, intDiv} from "@chainsafe/lodestar-utils";
import {ArrayLike, List} from "@chainsafe/ssz";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {isValidAltairUpdate} from "./validation";

export function applyLightClientUpdate(
  config: IBeaconConfig,
  snapshot: altair.AltairSnapshot,
  update: altair.AltairUpdate
): void {
  const snapshotPeriod = intDiv(
    computeEpochAtSlot(config, snapshot.header.slot),
    config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
  );
  const updatePeriod = intDiv(
    computeEpochAtSlot(config, update.header.slot),
    config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
  );
  if (updatePeriod === snapshotPeriod + 1) {
    snapshot.currentSyncCommittee = snapshot.nextSyncCommittee;
    snapshot.nextSyncCommittee = update.nextSyncCommittee;
  }
  snapshot.header = update.header;
}

export function processAltairUpdate(
  config: IBeaconConfig,
  store: altair.AltairStore,
  update: altair.AltairUpdate,
  currentSlot: Slot
): void {
  assert.true(isValidAltairUpdate(config, store.snapshot, update));
  store.validUpdates.push(update);
  if (
    sumBits(update.syncCommitteeBits) * 3 > update.syncCommitteeBits.length * 2 &&
    !config.types.altair.BeaconBlockHeader.equals(update.header, update.finalityHeader)
  ) {
    applyLightClientUpdate(config, store.snapshot, update);
    store.validUpdates = new Array<altair.AltairUpdate>() as List<altair.AltairUpdate>;
  } else if (currentSlot > store.snapshot.header.slot + LIGHT_CLIENT_UPDATE_TIMEOUT) {
    applyLightClientUpdate(config, store.snapshot, bestUpdate(Array.from(store.validUpdates))!);
    store.validUpdates = new Array<altair.AltairUpdate>() as List<altair.AltairUpdate>;
  }
}

function bestUpdate(updates: altair.AltairUpdate[]): altair.AltairUpdate | null {
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
  for (const bit in bits) {
    if (bit) {
      sum++;
    }
  }
  return sum;
}
