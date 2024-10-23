import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconState, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {formatBytes} from "@lodestar/utils";
import {IBeaconDb} from "../../db/interface.js";
import {HistoricalStateRegenMetrics, IStateDiffCodec, HistoricalStateStorageType} from "./types.js";
import {replayBlocks} from "./utils/blockReplay.js";
import {HierarchicalLayers} from "./utils/hierarchicalLayers.js";
import {XDelta3Codec} from "./utils/xdelta3.js";
import {getDiffStateArchive} from "./utils/diff.js";
import {StateArchiveMode} from "../archiver/interface.js";
import {
  computeDiffArchive,
  getLastStoredStateArchive,
  stateArchiveToStateBytes,
  stateBytesToStateArchive,
  stateToStateArchive,
} from "./utils/stateArchive.js";
import {StateArchiveSSZType} from "../../db/repositories/stateArchive.js";

export const codec: IStateDiffCodec = new XDelta3Codec();

type HStateOperationOptions = {
  db: IBeaconDb;
  config: BeaconConfig;
  logger: Logger;
  hierarchicalLayers: HierarchicalLayers;
  metrics?: HistoricalStateRegenMetrics;
  stateArchiveMode: StateArchiveMode;
};

export async function getHistoricalState(
  slot: Slot,
  {
    stateArchiveMode,
    db,
    logger,
    config,
    metrics,
    hierarchicalLayers,
    pubkey2index,
  }: HStateOperationOptions & {pubkey2index: PubkeyIndexMap}
): Promise<Uint8Array | null> {
  const regenTimer = metrics?.regenTime.startTimer();
  const epoch = computeEpochAtSlot(slot);
  const slotType = hierarchicalLayers.getStorageType(slot, stateArchiveMode);
  logger.verbose("Fetching state archive", {slotType, slot, epoch});

  switch (slotType) {
    case HistoricalStateStorageType.Full: {
      const loadStateTimer = metrics?.loadSnapshotStateTime.startTimer();
      // It's a legacy format we use raw state as full object
      const state = await db.stateArchive.getBinary(slot);
      loadStateTimer?.();
      regenTimer?.({strategy: HistoricalStateStorageType.Full});
      return state;
    }

    case HistoricalStateStorageType.Snapshot: {
      const loadStateTimer = metrics?.loadSnapshotStateTime.startTimer();
      const stateArchive = await db.stateArchive.get(slot);

      const state = stateArchive ? stateArchiveToStateBytes(stateArchive, config) : null;

      loadStateTimer?.();
      regenTimer?.({strategy: HistoricalStateStorageType.Snapshot});
      return state;
    }
    case HistoricalStateStorageType.Diff: {
      const {stateArchive} = await getDiffStateArchive(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );
      regenTimer?.({strategy: HistoricalStateStorageType.Diff});

      return stateArchive ? stateArchiveToStateBytes(stateArchive, config) : null;
    }
    case HistoricalStateStorageType.BlockReplay: {
      const {stateArchive, diffSlots} = await getDiffStateArchive(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );

      if (!stateArchive) {
        regenTimer?.({strategy: HistoricalStateStorageType.BlockReplay});
        return null;
      }

      const state = replayBlocks(
        {
          toSlot: slot,
          lastFullSlot: diffSlots[diffSlots.length - 1],
          lastFullStateBytes: stateArchiveToStateBytes(stateArchive, config),
        },
        {config, db, metrics, pubkey2index}
      );

      regenTimer?.({strategy: HistoricalStateStorageType.BlockReplay});

      return state;
    }
  }
}

export async function putHistoricalState(
  slot: Slot,
  stateBytes: Uint8Array,
  {db, logger, metrics, hierarchicalLayers, stateArchiveMode, config}: HStateOperationOptions
): Promise<void> {
  const epoch = computeEpochAtSlot(slot);
  const storageType = hierarchicalLayers.getStorageType(slot, stateArchiveMode);
  logger.info("Archiving historical state", {epoch, slot, slotType: storageType});

  switch (storageType) {
    case HistoricalStateStorageType.Full: {
      metrics?.stateSnapshotSize.set(stateBytes.byteLength);
      await db.stateArchive.putBinary(slot, stateBytes);
      logger.verbose("State stored as full", {
        epoch,
        slot,
        snapshotSize: formatBytes(stateBytes.byteLength),
      });
      break;
    }

    case HistoricalStateStorageType.Snapshot: {
      const stateArchive = stateBytesToStateArchive(stateBytes, config);
      const stateArchiveBytes = StateArchiveSSZType.serialize(stateArchive);
      await db.stateArchive.put(slot, stateArchive);

      metrics?.stateSnapshotSize.set(stateBytes.byteLength);
      logger.verbose("State stored as snapshot", {
        epoch,
        slot,
        snapshotSize: formatBytes(stateArchiveBytes.byteLength),
      });
      break;
    }
    case HistoricalStateStorageType.Diff: {
      const {stateArchive: diffStateArchive} = await getDiffStateArchive(
        {slot, skipSlotDiff: true},
        {db, metrics, logger, hierarchicalLayers, codec}
      );

      if (!diffStateArchive) return;

      const diffArchive = computeDiffArchive(diffStateArchive, stateBytesToStateArchive(stateBytes, config), codec);

      const diffArchiveBytes = StateArchiveSSZType.serialize(diffArchive);
      await db.stateArchive.put(slot, diffArchive);

      metrics?.stateDiffSize.set(diffArchiveBytes.byteLength);
      logger.verbose("State stored as diff", {
        epoch,
        slot,
        diffSize: formatBytes(diffArchiveBytes.byteLength),
      });
      break;
    }
    case HistoricalStateStorageType.BlockReplay: {
      logger.verbose("Skipping storage of historical state for block replay", {
        epoch,
        slot,
      });

      break;
    }
  }
}

export async function storeGenesisState(
  state: BeaconState,
  {
    db,
    archiveMode,
    forkConfig,
  }: {
    db: IBeaconDb;
    forkConfig: ChainForkConfig;
    archiveMode: StateArchiveMode;
  }
) {
  if (archiveMode === StateArchiveMode.Frequency) {
    await db.stateArchive.putBinary(state.slot, forkConfig.getForkTypes(state.slot).BeaconState.serialize(state));
  } else {
    await db.stateArchive.put(state.slot, stateToStateArchive(state, forkConfig));
  }
}

export async function getLastStoredState({
  db,
  hierarchicalLayers,
  metrics,
  logger,
  archiveMode,
  forkConfig,
}: {
  db: IBeaconDb;
  hierarchicalLayers: HierarchicalLayers;
  archiveMode: StateArchiveMode;
  forkConfig: ChainForkConfig;
  metrics?: HistoricalStateRegenMetrics;
  logger?: Logger;
}): Promise<{stateBytes: Uint8Array | null; slot: Slot | null}> {
  if (archiveMode === StateArchiveMode.Frequency) {
    const lastStoredSlot = await db.stateArchive.lastKey();
    return {stateBytes: lastStoredSlot ? await db.stateArchive.getBinary(lastStoredSlot) : null, slot: lastStoredSlot};
  }

  const lastStoredDiffArchive = await getLastStoredStateArchive({db, snapshot: false});
  const lastStoredSnapshotArchive = await getLastStoredStateArchive({db, snapshot: true});

  if (!lastStoredDiffArchive && !lastStoredSnapshotArchive) {
    logger?.verbose("State archive db is empty");
    return {stateBytes: null, slot: null};
  }

  if (!lastStoredSnapshotArchive) {
    logger?.verbose("State archive db does not contain any snapshot state");
    // TODO: Need to clean the stateArchive db
    return {stateBytes: null, slot: null};
  }

  logger?.info("Last archived state slots", {
    snapshot: lastStoredSnapshotArchive?.slot,
    diff: lastStoredDiffArchive?.slot,
  });

  const lastStoredSlot = Math.max(lastStoredDiffArchive?.slot ?? 0, lastStoredSnapshotArchive.slot ?? 0);
  const storageType = hierarchicalLayers.getStorageType(lastStoredSlot, archiveMode);
  logger?.verbose("Loading the last archived state", {storageType, slot: lastStoredSlot});

  switch (storageType) {
    case HistoricalStateStorageType.Full: {
      return {stateBytes: await db.stateArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
    }
    case HistoricalStateStorageType.Snapshot: {
      const stateArchive = await db.stateArchive.getBinary(lastStoredSlot);

      return {
        stateBytes: stateArchive
          ? stateArchiveToStateBytes(StateArchiveSSZType.deserialize(stateArchive), forkConfig)
          : null,
        slot: lastStoredSlot,
      };
    }
    case HistoricalStateStorageType.Diff: {
      if (lastStoredSlot === lastStoredSnapshotArchive.slot) {
        logger?.warn("Last archived snapshot is not at expected epoch boundary, possibly because of checkpoint sync.");
        return {stateBytes: await db.stateArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
      }

      const diffStateArchive = await getDiffStateArchive(
        {slot: lastStoredSlot, skipSlotDiff: false},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );

      if (!diffStateArchive.stateArchive) throw new Error("Can not compute the last stored state");

      return {
        stateBytes: stateArchiveToStateBytes(diffStateArchive.stateArchive, forkConfig),
        slot: lastStoredSlot,
      };
    }
    case HistoricalStateStorageType.BlockReplay:
      if (lastStoredSlot === lastStoredSnapshotArchive.slot) {
        logger?.warn("Last archived snapshot is not at expected epoch boundary, possibly because of checkpoint sync.");
        return {stateBytes: stateArchiveToStateBytes(lastStoredSnapshotArchive, forkConfig), slot: lastStoredSlot};
      }

      throw new Error(`Unexpected stored slot for a non epoch slot=${lastStoredSlot}`);
  }
}

export async function migrateStateArchive({
  db,
  archiveMode,
  logger,
}: {db: IBeaconDb; archiveMode: StateArchiveMode; logger?: Logger}): Promise<void> {
  if (archiveMode === StateArchiveMode.Differential) {
    const lastStoredSlot = await db.stateArchive.lastKey();
    if (!lastStoredSlot) return;

    const archiveBytes = await db.stateArchive.getBinary(lastStoredSlot);
    if (!archiveBytes) return;

    try {
      StateArchiveSSZType.deserialize(archiveBytes);
    } catch {
      logger?.info("Found that stateArchiveMode was switch recently. Cleaning up state archives to store new format.");
      for await (const slot of db.stateArchive.keysStream()) {
        await db.stateArchive.delete(slot);
      }
    }
  }

  return;
}
