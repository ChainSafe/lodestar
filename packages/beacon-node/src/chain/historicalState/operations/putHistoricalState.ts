import {Slot} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {formatBytes} from "@lodestar/utils";
import {IStateDiffCodec, HistoricalStateStorageType, HierarchicalStateOperationOptions} from "../types.js";
import {XDelta3Codec} from "../utils/xdelta3.js";
import {getDiffStateArchive} from "../utils/diff.js";
import {computeDiffArchive, stateBytesToStateArchive} from "../utils/stateArchive.js";
import {StateArchiveSSZType} from "../../../db/repositories/hierarchicalStateArchive.js";

export const codec: IStateDiffCodec = new XDelta3Codec();

export async function putHistoricalState(
  slot: Slot,
  stateBytes: Uint8Array,
  {db, logger, metrics, hierarchicalLayers, stateArchiveMode, config}: HierarchicalStateOperationOptions
): Promise<void> {
  const epoch = computeEpochAtSlot(slot);
  const storageType = hierarchicalLayers.getStorageType(slot, stateArchiveMode);
  logger.info("Archiving historical state", {epoch, slot, storageType});

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
      await db.hierarchicalStateArchiveRepository.put(slot, stateArchive);

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
      await db.hierarchicalStateArchiveRepository.put(slot, diffArchive);

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
