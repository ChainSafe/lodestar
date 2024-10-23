import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {ChainForkConfig} from "@lodestar/config";
import {IBeaconDb} from "../../../db/interface.js";
import {HistoricalStateRegenMetrics, IStateDiffCodec, HistoricalStateStorageType} from "../types.js";
import {HierarchicalLayers} from "../utils/hierarchicalLayers.js";
import {XDelta3Codec} from "../utils/xdelta3.js";
import {getDiffStateArchive} from "../utils/diff.js";
import {StateArchiveMode} from "../../archiver/interface.js";
import {getLastStoredStateArchive, stateArchiveToStateBytes} from "../utils/stateArchive.js";
import {StateArchiveSSZType} from "../../../db/repositories/stateArchive.js";

export const codec: IStateDiffCodec = new XDelta3Codec();

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
