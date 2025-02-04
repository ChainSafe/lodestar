import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {formatBytes} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {DifferentialArchiveStrategy, HistoricalStateMetrics, IBinaryDiffCodec} from "../interface.js";
import {XDelta3Codec} from "../utils/xDelta3Codec.js";
import {replayBlocks} from "./blockReplay.js";
import {getDiffState} from "./diff.js";
import {DifferentialLayers} from "./differentialLayers.js";

export const codec: IBinaryDiffCodec = new XDelta3Codec();

export async function getHistoricalState(
  {slot}: {slot: Slot},
  {
    db,
    logger,
    config,
    metrics,
    diffLayers,
    pubkey2index,
  }: {
    config: BeaconConfig;
    db: IBeaconDb;
    pubkey2index: PubkeyIndexMap;
    logger: Logger;
    diffLayers: DifferentialLayers;
    metrics?: HistoricalStateMetrics;
  }
): Promise<Uint8Array | null> {
  const regenTimer = metrics?.regenTime.startTimer();
  const epoch = computeEpochAtSlot(slot);
  const strategy = diffLayers.getArchiveStrategy(slot);
  logger.verbose("Fetching state archive", {strategy, slot, epoch});

  switch (strategy) {
    case DifferentialArchiveStrategy.Snapshot: {
      const loadStateTimer = metrics?.loadSnapshotStateTime.startTimer();
      const state = await db.stateSnapshotArchive.getBinary(slot);
      loadStateTimer?.();
      regenTimer?.({strategy: DifferentialArchiveStrategy.Snapshot});
      return state;
    }
    case DifferentialArchiveStrategy.Diff: {
      const {diffStateBytes: diffState} = await getDiffState(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, diffLayers, codec}
      );
      regenTimer?.({strategy: DifferentialArchiveStrategy.Diff});

      return diffState;
    }
    case DifferentialArchiveStrategy.BlockReplay: {
      const {diffStateBytes, diffSlots} = await getDiffState(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, diffLayers, codec}
      );

      if (!diffStateBytes) {
        regenTimer?.({strategy: DifferentialArchiveStrategy.BlockReplay});
        return null;
      }

      const state = replayBlocks(
        {toSlot: slot, lastFullSlot: diffSlots[diffSlots.length - 1], lastFullStateBytes: diffStateBytes},
        {config, db, metrics, pubkey2index}
      );

      regenTimer?.({strategy: DifferentialArchiveStrategy.BlockReplay});

      return state;
    }
  }
}

export async function putHistoricalState(
  {slot, stateBytes}: {slot: Slot; stateBytes: Uint8Array},
  {
    db,
    logger,
    metrics,
    diffLayers,
  }: {
    db: IBeaconDb;
    logger: Logger;
    metrics?: HistoricalStateMetrics;
    diffLayers: DifferentialLayers;
  }
): Promise<void> {
  const epoch = computeEpochAtSlot(slot);
  const strategy = diffLayers.getArchiveStrategy(slot);
  logger.info("Archiving historical state", {epoch, slot, strategy});

  switch (strategy) {
    case DifferentialArchiveStrategy.Snapshot: {
      metrics?.stateSnapshotSize.set(stateBytes.byteLength);
      await db.stateSnapshotArchive.putBinary(slot, stateBytes);
      logger.verbose("State stored as snapshot", {
        epoch,
        slot,
        snapshotSize: formatBytes(stateBytes.byteLength),
      });
      break;
    }
    case DifferentialArchiveStrategy.Diff: {
      const {diffStateBytes: diffState} = await getDiffState(
        {slot, skipSlotDiff: true},
        {db, metrics, logger, diffLayers, codec}
      );

      if (!diffState) return;

      const diff = codec.compute(diffState, stateBytes);
      await db.stateDiffArchive.putBinary(slot, diff);

      metrics?.stateDiffSize.set(diff.byteLength);

      logger.verbose("State stored as diff", {
        epoch,
        slot,
        baseSize: formatBytes(diffState.byteLength),
        diffSize: formatBytes(diff.byteLength),
      });
      break;
    }
    case DifferentialArchiveStrategy.BlockReplay: {
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
  diffLayers,
  metrics,
  logger,
}: {
  db: IBeaconDb;
  diffLayers: DifferentialLayers;
  metrics?: HistoricalStateMetrics;
  logger?: Logger;
}): Promise<{stateBytes: Uint8Array | null; slot: Slot | null}> {
  const lastStoredDiffSlot = await db.stateDiffArchive.lastKey();
  const lastStoredSnapshotSlot = await db.stateSnapshotArchive.lastKey();

  logger?.info("Last archived state slots", {snapshot: lastStoredSnapshotSlot, diff: lastStoredDiffSlot});

  if (lastStoredDiffSlot === null && lastStoredSnapshotSlot === null) {
    logger?.verbose("State archive db is empty");
    return {stateBytes: null, slot: null};
  }

  const lastStoredSlot = Math.max(lastStoredDiffSlot ?? 0, lastStoredSnapshotSlot ?? 0);
  const strategy = diffLayers.getArchiveStrategy(lastStoredSlot);
  logger?.verbose("Loading the last archived state", {strategy, slot: lastStoredSlot});

  switch (strategy) {
    case DifferentialArchiveStrategy.Snapshot:
      return {stateBytes: await db.stateSnapshotArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
    case DifferentialArchiveStrategy.Diff: {
      if (lastStoredSlot === lastStoredSnapshotSlot) {
        logger?.warn("Last archived snapshot is not at expected epoch boundary, possibly because of checkpoint sync.");
        return {stateBytes: await db.stateSnapshotArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
      }

      const {diffStateBytes} = await getDiffState(
        {slot: lastStoredSlot, skipSlotDiff: false},
        {db, metrics, logger, diffLayers, codec}
      );

      return {
        stateBytes: diffStateBytes,
        slot: lastStoredSlot,
      };
    }
    case DifferentialArchiveStrategy.BlockReplay:
      if (lastStoredSlot === lastStoredSnapshotSlot) {
        logger?.warn("Last archived snapshot is not at expected epoch boundary, possibly because of checkpoint sync.");
        return {stateBytes: await db.stateSnapshotArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
      }
      throw new Error(`Unexpected stored slot for a non epoch slot=${lastStoredSlot}`);
  }
}
