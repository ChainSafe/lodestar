import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {formatBytes} from "@lodestar/utils";
import {HistoricalStateRegenMetrics, IStateDiffCodec, RegenErrorType} from "../types.js";
import {IBeaconDb} from "../../../db/interface.js";
import {HierarchicalLayers} from "./hierarchicalLayers.js";
import {getSnapshotStateArchiveWithFallback} from "./snapshot.js";
import {applyDiffArchive, getLastStoredStateArchive} from "./stateArchive.js";
import {StateArchive, StateArchiveSSZType} from "../../../db/repositories/hierarchicalStateArchive.js";

export async function replayStateDiffs(
  {diffArchives, snapshotArchive}: {diffArchives: StateArchive[]; snapshotArchive: StateArchive},
  {codec, logger}: {codec: IStateDiffCodec; logger?: Logger}
): Promise<StateArchive> {
  let activeStateArchive: StateArchive = snapshotArchive;

  for (const intermediateStateArchive of diffArchives) {
    logger?.verbose("Applying state diff", {
      slot: intermediateStateArchive.slot,
      activeStateSize: formatBytes(StateArchiveSSZType.serialize(activeStateArchive).byteLength),
      diffSize: formatBytes(StateArchiveSSZType.serialize(intermediateStateArchive).byteLength),
    });
    activeStateArchive = applyDiffArchive(activeStateArchive, intermediateStateArchive, codec);
  }

  return activeStateArchive;
}

export async function getDiffStateArchive(
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
    codec: IStateDiffCodec;
  }
): Promise<{stateArchive: StateArchive | null; diffSlots: Slot[]}> {
  const epoch = computeEpochAtSlot(slot);
  const diffSlots = hierarchicalLayers.getArchiveLayers(slot);
  const processableDiffs = [...diffSlots];

  if (processableDiffs.length < 1) {
    logger?.error("Error detecting the diff layers", {slot, skipSlotDiff, diffSlots: diffSlots.join(",")});
    return {diffSlots, stateArchive: null};
  }

  // Remove the snapshot slot
  let expectedSnapshotSlot = processableDiffs.shift() as number;
  if (skipSlotDiff && processableDiffs[processableDiffs.length - 1] === slot) {
    processableDiffs.pop();
  }

  const snapshotArchive = await getSnapshotStateArchiveWithFallback({
    slot: expectedSnapshotSlot,
    db,
    fallbackTillSlot: hierarchicalLayers.getPreviousSlotForLayer(expectedSnapshotSlot - 1, 0),
  }).then((state) => {
    if (!state) return getLastStoredStateArchive({db, snapshot: true});

    return null;
  });

  if (!snapshotArchive) {
    logger?.error("Missing the snapshot state", {snapshotSlot: expectedSnapshotSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlots, stateArchive: null};
  }

  const availableSnapshotSlot = snapshotArchive.slot;

  if (availableSnapshotSlot >= slot) {
    logger?.debug("Found snapshot at higher or same slot", {
      expectedSnapshotSlot,
      availableSnapshotSlot,
    });
    return {diffSlots, stateArchive: null};
  }

  if (availableSnapshotSlot !== expectedSnapshotSlot) {
    // Possibly because of checkpoint sync
    logger?.warn("Last archived snapshot is not at expected slot", {
      expectedSnapshotSlot,
      availableSnapshotSlot: snapshotArchive.slot,
    });
    expectedSnapshotSlot = snapshotArchive.slot;
  }

  // Get all diffs except the first one which was a snapshot layer
  const diffArchives = await Promise.all(
    processableDiffs.map((s) => {
      const loadStateTimer = metrics?.loadDiffStateTime.startTimer();
      return db.hierarchicalStateArchiveRepository.get(s).then((diff) => {
        loadStateTimer?.();
        return diff;
      });
    })
  );

  const nonEmptyDiffs = diffArchives.filter(Boolean) as StateArchive[];

  if (nonEmptyDiffs.length < processableDiffs.length) {
    logger?.warn("Missing some diff states", {
      epoch,
      slot,
      snapshotSlot: expectedSnapshotSlot,
      diffPath: diffSlots.join(","),
      availableDiffs: nonEmptyDiffs.map((d) => d.slot).join(","),
    });
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
  }

  try {
    logger?.verbose("Replaying state diffs", {
      epoch,
      slot,
      snapshotSlot: expectedSnapshotSlot,
      diffPath: diffSlots.join(","),
      availableDiffs: nonEmptyDiffs.map((d) => d.slot).join(","),
    });

    const diffState = await replayStateDiffs({diffArchives: nonEmptyDiffs, snapshotArchive}, {codec, logger});

    if (diffState.partialState.byteLength === 0 || diffState.balances.byteLength === 0) {
      throw new Error("Some error during applying diffs");
    }

    return {diffSlots, stateArchive: diffState};
  } catch (err) {
    logger?.error(
      "Can not compute the diff state",
      {epoch, slot, snapshotSlot: expectedSnapshotSlot, diffPath: diffSlots.join(",")},
      err as Error
    );
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlots, stateArchive: null};
  }
}
