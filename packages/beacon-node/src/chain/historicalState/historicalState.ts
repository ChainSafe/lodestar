import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {formatBytes} from "@lodestar/utils";
import {IBeaconDb} from "../../db/interface.js";
import {HistoricalStateRegenMetrics, IBinaryDiffCodec, HistoricalStateSlotType} from "./types.js";
import {replayBlocks} from "./utils/blockReplay.js";
import {HierarchicalLayers} from "./utils/hierarchicalLayers.js";
import {XDelta3Codec} from "./utils/xdelta3.js";
import {getDiffState} from "./utils/diff.js";
import {StateArchiveMode} from "../archiver/interface.js";

export const codec: IBinaryDiffCodec = new XDelta3Codec();

export async function getHistoricalState(
  {slot, archiveMode}: {slot: Slot; archiveMode: StateArchiveMode},
  {
    db,
    logger,
    config,
    metrics,
    hierarchicalLayers,
    pubkey2index,
  }: {
    config: BeaconConfig;
    db: IBeaconDb;
    pubkey2index: PubkeyIndexMap;
    logger: Logger;
    hierarchicalLayers: HierarchicalLayers;
    metrics?: HistoricalStateRegenMetrics;
  }
): Promise<Uint8Array | null> {
  const regenTimer = metrics?.regenTime.startTimer();
  const epoch = computeEpochAtSlot(slot);
  const strategy = hierarchicalLayers.getSlotType(slot, archiveMode);
  logger.verbose("Fetching state archive", {strategy, slot, epoch});

  switch (strategy) {
    case HistoricalStateSlotType.Full: {
      const loadStateTimer = metrics?.loadSnapshotStateTime.startTimer();
      const state = await db.stateArchive.getBinary(slot);
      loadStateTimer?.();
      regenTimer?.({strategy: HistoricalStateSlotType.Full});
      return state;
    }

    case HistoricalStateSlotType.Snapshot: {
      const loadStateTimer = metrics?.loadSnapshotStateTime.startTimer();
      const state = await db.stateArchive.getBinary(slot);
      loadStateTimer?.();
      regenTimer?.({strategy: HistoricalStateSlotType.Snapshot});
      return state;
    }
    case HistoricalStateSlotType.Diff: {
      const {diffStateBytes: diffState} = await getDiffState(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );
      regenTimer?.({strategy: HistoricalStateSlotType.Diff});

      return diffState;
    }
    case HistoricalStateSlotType.BlockReplay: {
      const {diffStateBytes, diffSlots} = await getDiffState(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );

      if (!diffStateBytes) {
        regenTimer?.({strategy: HistoricalStateSlotType.BlockReplay});
        return null;
      }

      const state = replayBlocks(
        {toSlot: slot, lastFullSlot: diffSlots[diffSlots.length - 1], lastFullStateBytes: diffStateBytes},
        {config, db, metrics, pubkey2index}
      );

      regenTimer?.({strategy: HistoricalStateSlotType.BlockReplay});

      return state;
    }
  }
}

export async function putHistoricalState(
  {slot, archiveMode, stateBytes}: {slot: Slot; archiveMode: StateArchiveMode; stateBytes: Uint8Array},
  {
    db,
    logger,
    metrics,
    hierarchicalLayers,
  }: {
    db: IBeaconDb;
    logger: Logger;
    metrics?: HistoricalStateRegenMetrics;
    hierarchicalLayers: HierarchicalLayers;
  }
): Promise<void> {
  const epoch = computeEpochAtSlot(slot);
  const strategy = hierarchicalLayers.getSlotType(slot, archiveMode);
  logger.info("Archiving historical state", {epoch, slot, strategy});

  switch (strategy) {
    case HistoricalStateSlotType.Full: {
      metrics?.stateSnapshotSize.set(stateBytes.byteLength);
      await db.stateArchive.putBinary(slot, stateBytes);
      logger.verbose("State stored as full", {
        epoch,
        slot,
        snapshotSize: formatBytes(stateBytes.byteLength),
      });
      break;
    }

    case HistoricalStateSlotType.Snapshot: {
      metrics?.stateSnapshotSize.set(stateBytes.byteLength);
      await db.stateArchive.putBinary(slot, stateBytes);
      logger.verbose("State stored as snapshot", {
        epoch,
        slot,
        snapshotSize: formatBytes(stateBytes.byteLength),
      });
      break;
    }
    case HistoricalStateSlotType.Diff: {
      const {diffStateBytes: diffState} = await getDiffState(
        {slot, skipSlotDiff: true},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );

      if (!diffState) return;

      const diff = codec.compute(diffState, stateBytes);
      await db.stateArchive.putBinary(slot, diff);

      metrics?.stateDiffSize.set(diff.byteLength);

      logger.verbose("State stored as diff", {
        epoch,
        slot,
        baseSize: formatBytes(diffState.byteLength),
        diffSize: formatBytes(diff.byteLength),
      });
      break;
    }
    case HistoricalStateSlotType.BlockReplay: {
      logger.verbose("Skipping storage of historical state for block replay", {
        epoch,
        slot,
      });

      break;
    }
  }
}

export async function getLastStoredState({
  db,
  hierarchicalLayers,
  metrics,
  logger,
  archiveMode,
}: {
  db: IBeaconDb;
  hierarchicalLayers: HierarchicalLayers;
  archiveMode: StateArchiveMode;
  metrics?: HistoricalStateRegenMetrics;
  logger?: Logger;
}): Promise<{stateBytes: Uint8Array | null; slot: Slot | null}> {
  const lastStoredDiffSlot = await db.stateArchive.lastKey();
  const lastStoredSnapshotSlot = await db.stateArchive.lastKey();

  logger?.info("Last archived state slots", {snapshot: lastStoredSnapshotSlot, diff: lastStoredDiffSlot});

  if (lastStoredDiffSlot === null && lastStoredSnapshotSlot === null) {
    logger?.verbose("State archive db is empty");
    return {stateBytes: null, slot: null};
  }

  const lastStoredSlot = Math.max(lastStoredDiffSlot ?? 0, lastStoredSnapshotSlot ?? 0);
  const strategy = hierarchicalLayers.getSlotType(lastStoredSlot, archiveMode);
  logger?.verbose("Loading the last archived state", {strategy, slot: lastStoredSlot});

  switch (strategy) {
    case HistoricalStateSlotType.Full:
      return {stateBytes: await db.stateArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
    case HistoricalStateSlotType.Snapshot:
      return {stateBytes: await db.stateArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
    case HistoricalStateSlotType.Diff: {
      if (lastStoredSlot === lastStoredSnapshotSlot) {
        logger?.warn("Last archived snapshot is not at expected epoch boundary, possibly because of checkpoint sync.");
        return {stateBytes: await db.stateArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
      }

      const {diffStateBytes} = await getDiffState(
        {slot: lastStoredSlot, skipSlotDiff: false},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );

      return {
        stateBytes: diffStateBytes,
        slot: lastStoredSlot,
      };
    }
    case HistoricalStateSlotType.BlockReplay:
      if (lastStoredSlot === lastStoredSnapshotSlot) {
        logger?.warn("Last archived snapshot is not at expected epoch boundary, possibly because of checkpoint sync.");
        return {stateBytes: await db.stateArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
      }
      throw new Error(`Unexpected stored slot for a non epoch slot=${lastStoredSlot}`);
  }
}
