import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {Slot} from "@lodestar/types";
import {formatBytes} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {
  DifferentialArchiveStrategy,
  DifferentialStateOperation,
  HistoricalStateMetrics,
  IBinaryDiffCodec,
  RegenErrorType,
} from "../interface.js";
import {replayBlocks} from "./blockReplay.js";
import {DifferentialLayers} from "./differentialLayers.js";
import {XDelta3Codec} from "./xDelta3Codec.js";

export const codec: IBinaryDiffCodec = new XDelta3Codec();

type CommonModules = {
  db: IBeaconDb;
  logger: Logger;
  diffLayers: DifferentialLayers;
  metrics: HistoricalStateMetrics | null;
};

export async function processDifferentialStateOperation<T extends DifferentialStateOperation>(
  modules: T extends {blockReplay: undefined}
    ? CommonModules
    : CommonModules & {config: BeaconConfig; pubkey2index: PubkeyIndexMap},
  operation: T,
  opts?: {fallbackSnapshot?: boolean}
): Promise<{stateBytes: Uint8Array | null; slot: Slot}> {
  const {logger, metrics, db} = modules;
  const {snapshotSlot, diffSlots, blockReplay} = operation;

  const regenTimer = metrics?.regenTime.startTimer();
  logger.verbose("Processing differential state operation", {
    snapshotSlot,
    diffSlots: diffSlots.join(","),
    blockReplayFrom: blockReplay?.fromSlot,
    blockReplayTill: blockReplay?.tillSlot,
  });

  // 1. First step is to fetch the snapshot state
  const {slot: availableSnapshotSlot, stateBytes: snapshotStateBytes} = await getSnapshotState({
    snapshotSlot: snapshotSlot,
    db,
    fallback: opts?.fallbackSnapshot ?? true,
    metrics,
  });

  if (!snapshotStateBytes) {
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    throw new Error(`Can not find snapshot state for slot=${snapshotSlot}`);
  }

  if (snapshotSlot !== availableSnapshotSlot) {
    logger.warn("Expected snapshot not found", {expectedSnapshotSlot: snapshotSlot, availableSnapshotSlot});
  }

  // We don't have any diffs and block replay
  if (diffSlots.length === 0 && !blockReplay) {
    regenTimer?.({strategy: DifferentialArchiveStrategy.Snapshot});
    return {stateBytes: snapshotStateBytes, slot: availableSnapshotSlot};
  }

  // 2. Fetch all diff states
  const nonEmptyDiffs = await getDiffStates({diffSlots, metrics, db});
  if (nonEmptyDiffs.length < diffSlots.length) {
    logger?.warn("Missing some diff states", {
      snapshotSlot: availableSnapshotSlot,
      diffPath: diffSlots.join(","),
      availableDiffs: nonEmptyDiffs.map((d) => d.slot).join(","),
    });
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
  }

  if (nonEmptyDiffs.length === 0) {
    throw new Error(`Can not find any required diffs ${diffSlots.join(",")}`);
  }

  // 3. Replay state diff on top of snapshot
  logger?.verbose("Replaying state diffs", {
    snapshotSlot,
    diffPath: diffSlots.join(","),
    availableDiffs: nonEmptyDiffs.map((d) => d.slot).join(","),
  });
  const stateWithDiffApplied = await replayStateDiffs({diffStates: nonEmptyDiffs, snapshotStateBytes}, {codec, logger});
  if (!stateWithDiffApplied || stateWithDiffApplied.byteLength === 0) {
    throw new Error("Some error during applying diffs");
  }
  const lastFullSlot = nonEmptyDiffs[nonEmptyDiffs.length - 1].slot;
  // There is no blocks to replay
  if (!blockReplay) return {stateBytes: stateWithDiffApplied, slot: lastFullSlot};

  // 4. Replay blocks
  const stateWithBlockReplay = await replayBlocks(
    {toSlot: blockReplay.tillSlot, lastFullSlot: lastFullSlot, lastFullStateBytes: stateWithDiffApplied},
    modules
  );

  return {stateBytes: stateWithBlockReplay, slot: blockReplay.tillSlot};
}

async function getDiffState({
  diffSlot,
  db,
  metrics,
}: {diffSlot: Slot; db: IBeaconDb; metrics: HistoricalStateMetrics | null}): Promise<{
  stateBytes: Uint8Array | null;
  slot: Slot;
}> {
  const loadDiffStateTimer = metrics?.loadDiffStateTime.startTimer();
  const state = await db.stateDiffArchive.getBinary(diffSlot);
  loadDiffStateTimer?.();
  return {stateBytes: state, slot: diffSlot};
}

async function getDiffStates({
  diffSlots,
  db,
  metrics,
}: {diffSlots: Slot[]; db: IBeaconDb; metrics: HistoricalStateMetrics | null}): Promise<
  {stateBytes: Uint8Array; slot: Slot}[]
> {
  const result: {stateBytes: Uint8Array; slot: Slot}[] = [];

  for (const diffSlot of diffSlots) {
    const {stateBytes, slot} = await getDiffState({diffSlot, db, metrics});
    if (stateBytes !== undefined && stateBytes !== null) {
      result.push({stateBytes, slot});
    }
  }

  return result;
}

async function getSnapshotState({
  snapshotSlot,
  db,
  fallback,
  metrics,
}: {snapshotSlot: Slot; db: IBeaconDb; fallback: boolean; metrics: HistoricalStateMetrics | null}): Promise<{
  stateBytes: Uint8Array | null;
  slot: Slot;
}> {
  const loadSnapshotStateTimer = metrics?.loadSnapshotStateTime.startTimer();
  const state = await db.stateSnapshotArchive.getBinary(snapshotSlot);
  loadSnapshotStateTimer?.();

  if (state) return {slot: snapshotSlot, stateBytes: state};
  if (!state && !fallback) return {slot: snapshotSlot, stateBytes: null};

  // There is a possibility that node is started with checkpoint and initial snapshot
  // is not persisted on expected slot
  const lastSnapshotSlot = await db.stateSnapshotArchive.lastKey();
  if (lastSnapshotSlot && lastSnapshotSlot !== snapshotSlot) {
    return getSnapshotState({snapshotSlot: lastSnapshotSlot, db, fallback, metrics});
  }

  return {stateBytes: null, slot: snapshotSlot};
}

async function replayStateDiffs(
  {
    diffStates,
    snapshotStateBytes,
  }: {diffStates: {slot: Slot; stateBytes: Uint8Array}[]; snapshotStateBytes: Uint8Array},
  {codec, logger}: {codec: IBinaryDiffCodec; logger?: Logger}
): Promise<Uint8Array> {
  if (!codec.initialized) {
    logger?.verbose("Initializing the binary diff codec.");
    await codec.init();
  }

  let activeStateBytes: Uint8Array = snapshotStateBytes;
  for (const intermediateStateDiff of diffStates) {
    logger?.verbose("Applying state diff", {
      slot: intermediateStateDiff.slot,
      activeStateSize: formatBytes(activeStateBytes.byteLength),
      diffSize: formatBytes(intermediateStateDiff.stateBytes.byteLength),
    });
    activeStateBytes = codec.apply(activeStateBytes, intermediateStateDiff.stateBytes);
  }

  return activeStateBytes;
}
