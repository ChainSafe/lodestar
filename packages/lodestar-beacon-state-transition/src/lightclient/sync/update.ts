import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LIGHT_CLIENT_UPDATE_TIMEOUT} from "@chainsafe/lodestar-params";
import {Lightclient, Slot} from "@chainsafe/lodestar-types";
import {assert, intDiv} from "@chainsafe/lodestar-utils";
import {ArrayLike, List} from "@chainsafe/ssz";
import {computeEpochAtSlot} from "../..";
import {isValidLightclientUpdate} from "./validation";

export function applyLightClientUpdate(
  config: IBeaconConfig,
  snapshot: Lightclient.LightclientSnapshot,
  update: Lightclient.LightclientUpdate
): void {
  const snapshotPeriod = intDiv(
    computeEpochAtSlot(config, snapshot.header.slot),
    config.params.lightclient.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
  );
  const updatePeriod = intDiv(
    computeEpochAtSlot(config, update.header.slot),
    config.params.lightclient.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
  );
  if (updatePeriod === snapshotPeriod + 1) {
    snapshot.currentSyncCommittee = snapshot.nextSyncCommittee;
    snapshot.nextSyncCommittee = update.nextSyncCommittee;
  }
  snapshot.header = update.header;
}

export function processLightclientUpdate(
  config: IBeaconConfig,
  store: Lightclient.LightclientStore,
  update: Lightclient.LightclientUpdate,
  currentSlot: Slot
): void {
  assert.true(isValidLightclientUpdate(config, store.snapshot, update));
  store.validUpdates.push(update);
  if (
    sumBits(update.syncCommitteeBits) * 3 > update.syncCommitteeBits.length * 2 &&
    !config.types.lightclient.BeaconBlockHeader.equals(update.header, update.finalityHeader)
  ) {
    applyLightClientUpdate(config, store.snapshot, update);
    store.validUpdates = new Array<Lightclient.LightclientUpdate>() as List<Lightclient.LightclientUpdate>;
  } else if (currentSlot > store.snapshot.header.slot + LIGHT_CLIENT_UPDATE_TIMEOUT) {
    applyLightClientUpdate(config, store.snapshot, bestUpdate(Array.from(store.validUpdates))!);
    store.validUpdates = new Array<Lightclient.LightclientUpdate>() as List<Lightclient.LightclientUpdate>;
  }
}

function bestUpdate(updates: Lightclient.LightclientUpdate[]): Lightclient.LightclientUpdate | null {
  return updates.reduce<{update: Lightclient.LightclientUpdate | null; sum: number}>(
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
