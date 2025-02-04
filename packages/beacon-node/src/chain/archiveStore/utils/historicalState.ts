import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {formatBytes} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {DifferentialArchiveStrategy, HistoricalStateMetrics, IBinaryDiffCodec, RegenErrorType} from "../interface.js";
import {XDelta3Codec} from "../utils/xDelta3Codec.js";
import {replayBlocks} from "./blockReplay.js";
import {DifferentialLayers} from "./differentialLayers.js";

export const codec: IBinaryDiffCodec = new XDelta3Codec();

type CommonModules = {
  db: IBeaconDb;
  logger: Logger;
  diffLayers: DifferentialLayers;
  metrics?: HistoricalStateMetrics;
};

export async function getHistoricalState(
  {slot}: {slot: Slot},
  {
    db,
    logger,
    config,
    metrics,
    diffLayers,
    pubkey2index,
  }: CommonModules & {
    pubkey2index: PubkeyIndexMap;
    config: BeaconConfig;
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
  {db, logger, metrics, diffLayers}: CommonModules
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
}: CommonModules): Promise<{stateBytes: Uint8Array | null; slot: Slot | null}> {
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

export async function getSnapshotStateWithFallback(
  slot: Slot,
  db: IBeaconDb
): Promise<{stateBytes: Uint8Array | null; slot: Slot}> {
  const state = await db.stateSnapshotArchive.getBinary(slot);
  if (state) return {slot, stateBytes: state};

  // There is a possibility that node is started with checkpoint and initial snapshot
  // is not persisted on expected slot
  const lastSnapshotSlot = await db.stateSnapshotArchive.lastKey();
  if (lastSnapshotSlot !== null)
    return {
      slot: lastSnapshotSlot,
      stateBytes: await db.stateSnapshotArchive.getBinary(lastSnapshotSlot),
    };

  return {stateBytes: null, slot};
}

export async function replayStateDiffs(
  {diffs, snapshotStateBytes}: {diffs: {slot: Slot; diff: Uint8Array}[]; snapshotStateBytes: Uint8Array},
  {codec, logger}: {codec: IBinaryDiffCodec; logger?: Logger}
): Promise<Uint8Array> {
  if (!codec.initialized) {
    logger?.verbose("Initializing the binary diff codec.");
    await codec.init();
  }

  let activeStateBytes: Uint8Array = snapshotStateBytes;
  for (const intermediateStateDiff of diffs) {
    logger?.verbose("Applying state diff", {
      slot: intermediateStateDiff.slot,
      activeStateSize: formatBytes(activeStateBytes.byteLength),
      diffSize: formatBytes(intermediateStateDiff.diff.byteLength),
    });
    activeStateBytes = codec.apply(activeStateBytes, intermediateStateDiff.diff);
  }

  return activeStateBytes;
}

export async function getDiffState(
  {slot, skipSlotDiff}: {slot: Slot; skipSlotDiff: boolean},
  {
    db,
    metrics,
    logger,
    diffLayers,
    codec,
  }: CommonModules & {
    codec: IBinaryDiffCodec;
  }
): Promise<{diffStateBytes: Uint8Array | null; diffSlots: Slot[]}> {
  const epoch = computeEpochAtSlot(slot);
  const diffSlots = diffLayers.getArchiveLayers(slot);
  const processableDiffs = [...diffSlots];

  // Remove the snapshot slot
  let snapshotSlot = processableDiffs.shift();

  if (skipSlotDiff && processableDiffs[processableDiffs.length - 1] === slot) {
    processableDiffs.pop();
  }

  if (snapshotSlot === undefined) {
    logger?.error("Missing the snapshot state", {snapshotSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlots, diffStateBytes: null};
  }

  const snapshot = await getSnapshotStateWithFallback(snapshotSlot, db);
  if (!snapshot.stateBytes) {
    logger?.error("Missing the snapshot state", {snapshotSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffStateBytes: null, diffSlots};
  }

  if (snapshot.slot !== snapshotSlot) {
    // Possibly because of checkpoint sync
    logger?.warn("Last archived snapshot is not at expected slot", {
      expectedSnapshotSlot: snapshotSlot,
      availableSnapshotSlot: snapshot.slot,
    });
    snapshotSlot = snapshot.slot;
  }

  // Get all diffs except the first one which was a snapshot layer
  const diffs = await Promise.all(
    processableDiffs.map((s) => {
      const loadStateTimer = metrics?.loadDiffStateTime.startTimer();
      return db.stateDiffArchive.getBinary(s).then((diff) => {
        loadStateTimer?.();
        return {slot: s, diff};
      });
    })
  );
  const nonEmptyDiffs = diffs.filter((d) => d.diff !== undefined && d.diff !== null) as {
    slot: number;
    diff: Uint8Array;
  }[];

  if (nonEmptyDiffs.length < processableDiffs.length) {
    logger?.warn("Missing some diff states", {
      epoch,
      slot,
      snapshotSlot,
      diffPath: diffSlots.join(","),
      availableDiffs: nonEmptyDiffs.map((d) => d.slot).join(","),
    });
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
  }

  try {
    logger?.verbose("Replaying state diffs", {
      epoch,
      slot,
      snapshotSlot,
      diffPath: diffSlots.join(","),
      availableDiffs: nonEmptyDiffs.map((d) => d.slot).join(","),
    });
    const diffState = await replayStateDiffs(
      {diffs: nonEmptyDiffs, snapshotStateBytes: snapshot.stateBytes},
      {codec, logger}
    );

    if (diffState.byteLength === 0) {
      throw new Error("Some error during applying diffs");
    }

    return {diffSlots, diffStateBytes: diffState};
  } catch (err) {
    logger?.error(
      "Can not compute the diff state",
      {epoch, slot, snapshotSlot, diffPath: diffSlots.join(",")},
      err as Error
    );
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlots, diffStateBytes: null};
  }
}
