import {ByteListType, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconState, Slot, ssz} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {DifferentialStateOperation, IStateDiffCodec} from "../interface.js";
import {HierarchicalLayers} from "./hierarchicalLayers.js";

// Constants
const STORAGE_LIMITS = {
  STATE_DIFF_MAX_BYTES: 2 * 1024 * 1024 * 1024, // 2 GiB
  BALANCES_DIFF_MAX_BYTES: 200 * 1024 * 1024, // 200 MiB
} as const;

// Type definitions
export const DifferentialStateType = new ContainerType(
  {
    slot: ssz.Slot,
    stateDiffBytes: new ByteListType(STORAGE_LIMITS.STATE_DIFF_MAX_BYTES, {typeName: "StateDiff"}),
    balancesDiffBytes: new ByteListType(STORAGE_LIMITS.BALANCES_DIFF_MAX_BYTES, {typeName: "BalancesDiff"}),
  },
  {typeName: "StateDiff", jsonCase: "eth2"}
);

export type DifferentialState = ValueOf<typeof DifferentialStateType>;

// This type is used to represent the state and balances in a format suitable for differential state computation
type DifferentialStateView = {slot: Slot; stateBytes: Uint8Array; balancesBytes: Uint8Array};

/**
 * DifferentialStateManager handles the computation, application, and management of differential states
 * in the beacon chain. It provides an abstracted interface for working with differential states while
 * handling the complexities of state serialization and diff computation.
 */
export class DifferentialStateManager {
  private readonly config: ChainForkConfig;
  private readonly codec: IStateDiffCodec;
  private readonly layers: HierarchicalLayers;
  private readonly db: IBeaconDb;
  private readonly metrics?: HistoricalStateMetrics | null;
  private readonly logger?: Logger;

  constructor(modules: {
    config: ChainForkConfig;
    codec: IStateDiffCodec;
    layers: HierarchicalLayers;
    metrics?: HistoricalStateMetrics;
    logger: Logger;
    db: IBeaconDb;
  }) {
    this.config = modules.config;
    this.codec = modules.codec;
    this.layers = modules.layers;
    this.db = modules.db;
    this.metrics = modules.metrics ?? null;
    this.logger = modules.logger;
  }

  /**
   * Convert a differential state view to a BeaconState
   */
  toBeaconState(diffState: DifferentialStateView): BeaconState {
    const target = this.config.getForkTypes(diffState.slot).BeaconState.deserialize(diffState.stateBytes);
    const targetBalances = this.config.getForkTypes(diffState.slot).Balances.deserialize(diffState.balancesBytes);
    target.balances = targetBalances;

    if (target.slot !== diffState.slot) {
      throw new Error(`Invalid slot in differential state: expected ${diffState.slot}, got ${target.slot}`);
    }

    return target;
  }

  /**
   * Convert a BeaconState to a differential state view
   */
  toDifferentialState(base: BeaconState): DifferentialStateView {
    const baseBalances = [...base.balances];
    base.balances = [];
    const stateBytes = this.config.getForkTypes(base.slot).BeaconState.serialize(base);
    const balancesBytes = this.config.getForkTypes(base.slot).Balances.serialize(baseBalances);

    return {
      slot: base.slot,
      stateBytes,
      balancesBytes,
    };
  }

  /**
   * Compute the differential state between a base state and a target state view
   */
  computeDifferential(base: BeaconState, target: DifferentialStateView): DifferentialState {
    const baseBalances = [...base.balances];
    base.balances = [];

    const stateDiffBytes = this.codec.compute(
      this.config.getForkTypes(base.slot).BeaconState.serialize(base),
      target.stateBytes
    );
    const balancesDiffBytes = this.codec.compute(
      this.config.getForkTypes(base.slot).Balances.serialize(baseBalances),
      target.balancesBytes
    );

    return {
      slot: target.slot,
      stateDiffBytes,
      balancesDiffBytes,
    };
  }

  /**
   * Apply a differential state to a base state view
   */
  applyDifferential(base: DifferentialStateView, diff: DifferentialState): DifferentialStateView {
    const stateBytes = this.codec.apply(base.stateBytes, diff.stateDiffBytes);
    const balancesBytes = this.codec.apply(base.balancesBytes, diff.balancesDiffBytes);

    return {
      slot: diff.slot,
      stateBytes,
      balancesBytes,
    };
  }

  async getDifferentialState({
    diffSlot,
    db,
    metrics,
  }: {diffSlot: Slot; db: IBeaconDb; metrics: HistoricalStateMetrics | null}): Promise<{
    stateBytes: Uint8Array | null;
    slot: Slot;
  }> {
    const loadDiffStateTimer = metrics?.loadDiffStateTime.startTimer();
    const state = await db.differentialStateArchive.getBinary(diffSlot);
    loadDiffStateTimer?.();
    return {stateBytes: state, slot: diffSlot};
  }

  /**
   * Get the operation required to reach a target slot
   */
  getOperation(slot: Slot): DifferentialStateOperation {
    const path = this.layers.computeSlotPath(slot);
    const layers = [...new Set(path)];
    const snapshotSlot = layers[0];
    const diffSlots = layers.slice(1);
    const lastDiffSlot = diffSlots.at(-1);

    if (slot === lastDiffSlot || slot === snapshotSlot) {
      return {
        snapshotSlot,
        diffSlots,
        blockReplay: undefined,
      };
    }

    return {
      snapshotSlot,
      diffSlots,
      blockReplay: {
        fromSlot: lastDiffSlot ? lastDiffSlot + 1 : snapshotSlot + 1,
        tillSlot: slot,
      },
    };
  }

  async processOperation(
    modules: {pubkey2index: PubkeyIndexMap},
    operation: DifferentialStateOperation,
    opts?: {fallbackSnapshot?: boolean}
  ): Promise<{stateBytes: Uint8Array | null; slot: Slot}> {
    const {snapshotSlot, diffSlots, blockReplay} = operation;

    const regenTimer = this.metrics?.regenTime.startTimer();
    this.logger?.verbose("Processing differential state operation", {
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
    const stateWithDiffApplied = await replayStateDiffs(
      {diffStates: nonEmptyDiffs, snapshotStateBytes},
      {codec, logger}
    );
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
