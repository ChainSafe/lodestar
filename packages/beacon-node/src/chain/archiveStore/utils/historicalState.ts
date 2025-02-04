import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {formatBytes} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {HistoricalStateMetrics} from "../interface.js";
import {DifferentialLayers} from "./differentialLayers.js";
import {codec, processDifferentialStateOperation} from "./differentialStateArchive.js";

type CommonModules = {
  db: IBeaconDb;
  logger: Logger;
  diffLayers: DifferentialLayers;
  metrics: HistoricalStateMetrics | null;
};

export async function getHistoricalState(
  {slot}: {slot: Slot},
  modules: CommonModules & {
    pubkey2index: PubkeyIndexMap;
    config: BeaconConfig;
  }
): Promise<{stateBytes: Uint8Array | null; slot: Slot}> {
  const epoch = computeEpochAtSlot(slot);
  modules.logger.verbose("Fetching state archive", {slot, epoch});
  const operation = modules.diffLayers.getOperation(slot);
  return processDifferentialStateOperation(modules, operation, {fallbackSnapshot: true});
}

export async function putHistoricalState(
  {slot, stateBytes}: {slot: Slot; stateBytes: Uint8Array},
  modules: CommonModules
): Promise<void> {
  const {metrics, db, logger} = modules;
  const epoch = computeEpochAtSlot(slot);
  modules.logger.info("Storing historical state", {epoch, slot});

  // Get operations for the current slot
  const {snapshotSlot, diffSlots} = modules.diffLayers.getOperation(slot);
  const lastDiffSlot = diffSlots[diffSlots.length - 1];

  // If target slot is a snapshot slot
  if (snapshotSlot === slot) {
    metrics?.stateSnapshotSize.set(stateBytes.byteLength);
    await db.stateSnapshotArchive.putBinary(slot, stateBytes);
    logger.verbose("State stored as snapshot", {
      epoch,
      slot,
      snapshotSize: formatBytes(stateBytes.byteLength),
    });
    return;
  }

  // If target slot is supposed to be diff slot
  if (lastDiffSlot === slot) {
    const lastDiffState = await processDifferentialStateOperation(
      modules,
      {snapshotSlot, diffSlots: diffSlots.slice(0, -1), blockReplay: undefined},
      {fallbackSnapshot: true}
    );

    if (!lastDiffState.stateBytes) {
      logger.error("Required diff state is missing", {snapshotSlot, diffSlots: diffSlots.slice(0, -1).join(",")});
      return;
    }

    const diff = codec.compute(lastDiffState.stateBytes, stateBytes);
    await db.stateDiffArchive.putBinary(slot, diff);
    metrics?.stateDiffSize.set(diff.byteLength);

    logger.verbose("State stored as diff", {
      epoch,
      slot,
      baseSize: formatBytes(lastDiffState.stateBytes.byteLength),
      diffSize: formatBytes(diff.byteLength),
    });
  }

  // It seems the target slot is under range of block replay for which we don't store the state diff
  logger.verbose("Skipping storage of historical state for block replay", {
    epoch,
    slot,
  });
}

export async function getLastStoredState(
  modules: CommonModules
): Promise<{stateBytes: Uint8Array | null; slot: Slot | null}> {
  const {db, logger} = modules;
  const lastStoredDiffSlot = await db.stateDiffArchive.lastKey();
  const lastStoredSnapshotSlot = await db.stateSnapshotArchive.lastKey();

  logger?.info("Last archived state slots", {snapshot: lastStoredSnapshotSlot, diff: lastStoredDiffSlot});

  if (!lastStoredDiffSlot && !lastStoredSnapshotSlot) {
    logger?.verbose("State archive db is empty");
    return {stateBytes: null, slot: null};
  }

  const lastStoredSlot = Math.max(lastStoredDiffSlot ?? 0, lastStoredSnapshotSlot ?? 0);
  logger?.verbose("Loading the last archived state", {slot: lastStoredSlot});

  // Get operations for the current slot
  const {snapshotSlot, diffSlots} = modules.diffLayers.getOperation(lastStoredSlot);
  const lastDiffSlot = diffSlots[diffSlots.length - 1];

  if (lastStoredSlot === lastStoredSnapshotSlot) {
    return processDifferentialStateOperation(modules, {
      snapshotSlot: lastStoredSlot,
      diffSlots: [],
      blockReplay: undefined,
    });
  }

  if (lastStoredSlot === lastDiffSlot) {
    return processDifferentialStateOperation(modules, {snapshotSlot, diffSlots, blockReplay: undefined});
  }

  return processDifferentialStateOperation(modules, {
    snapshotSlot: lastStoredSlot,
    diffSlots: [],
    blockReplay: undefined,
  });
}
