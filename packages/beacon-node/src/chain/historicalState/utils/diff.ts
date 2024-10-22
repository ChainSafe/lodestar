import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {formatBytes} from "@lodestar/utils";
import {HistoricalStateRegenMetrics, IBinaryDiffCodec, RegenErrorType} from "../types.js";
import {IBeaconDb} from "../../../db/interface.js";
import {HierarchicalLayers} from "./hierarchicalLayers.js";
import {getSnapshotStateWithFallback} from "./snapshot.js";

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
    hierarchicalLayers,
    codec,
  }: {
    db: IBeaconDb;
    metrics?: HistoricalStateRegenMetrics;
    logger?: Logger;
    hierarchicalLayers: HierarchicalLayers;
    codec: IBinaryDiffCodec;
  }
): Promise<{diffStateBytes: Uint8Array | null; diffSlots: Slot[]}> {
  const epoch = computeEpochAtSlot(slot);
  const diffSlots = hierarchicalLayers.getArchiveLayers(slot);
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
      return db.stateArchive.getBinary(s).then((diff) => {
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
