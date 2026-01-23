import {ChainForkConfig} from "@lodestar/config";
import {BeaconState, Slot} from "@lodestar/types";
import {Logger, formatBytes} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {IStateDiffCodec} from "../interface.js";
import {DiffStateRegenErrorType, DifferentialStateRegenMetrics} from "./metrics.ts";
import {BeaconStateDifferential, BeaconStateSnapshot} from "./ssz.js";
import {beaconStateToSnapshot} from "./stateSnapshot.ts";

/**
 * Compute the differential state between a base state and a target state view
 */
export function computeStateDifferential(
  modules: {codec: IStateDiffCodec; config: ChainForkConfig; metrics?: DifferentialStateRegenMetrics | null},
  base: BeaconState,
  target: BeaconStateSnapshot
): BeaconStateDifferential {
  const {codec, config} = modules;

  const timer = modules.metrics?.computeDiffStateTime.startTimer();
  const baseSnapshot = beaconStateToSnapshot({config}, base);
  const stateDiffBytes = codec.compute(baseSnapshot.stateBytes, target.stateBytes);
  const balancesDiffBytes = codec.compute(baseSnapshot.balancesBytes, target.balancesBytes);
  timer?.();

  return {
    slot: target.slot,
    baseSlot: baseSnapshot.slot,
    stateDiffBytes,
    balancesDiffBytes,
  };
}

/**
 * Apply a differential state to a base state view
 */
export function applyStateDifferential(
  modules: {codec: IStateDiffCodec; logger?: Logger; metrics?: DifferentialStateRegenMetrics | null},
  base: BeaconStateSnapshot,
  diff: BeaconStateDifferential
): BeaconStateSnapshot {
  const {codec, logger} = modules;

  if (diff.baseSlot !== base.slot) {
    throw new Error(`Base slot mismatch when applying differential: expected ${diff.baseSlot}, got ${base.slot}`);
  }

  const logInfo = {
    baseSlot: base.slot,
    diffSlot: diff.slot,
    baseStateSize: formatBytes(base.stateBytes.byteLength + base.balancesBytes.byteLength),
    diffSize: formatBytes(diff.stateDiffBytes.byteLength + diff.balancesDiffBytes.byteLength),
  };

  logger?.verbose("Applying state differential", logInfo);
  const timer = modules.metrics?.applyDiffStateTime.startTimer();

  try {
    const stateBytes = codec.apply(base.stateBytes, diff.stateDiffBytes);
    const balancesBytes = codec.apply(base.balancesBytes, diff.balancesDiffBytes);
    timer?.();

    if (stateBytes.byteLength === 0 || balancesBytes.byteLength === 0) {
      throw new Error(
        `Invalid state after applying diffs: 
          stateBytesSize=${stateBytes.byteLength},
          balancesBytesSize=${balancesBytes.byteLength}`
      );
    }

    return {
      slot: diff.slot,
      stateBytes,
      balancesBytes,
    };
  } catch (error) {
    modules.metrics?.regenErrorCount.inc({reason: DiffStateRegenErrorType.diffReplay});
    logger?.error("Failed to apply state differential", logInfo);
    throw error;
  } finally {
    timer?.();
  }
}

export async function replayStateDifferentials(
  modules: {codec: IStateDiffCodec; logger?: Logger; metrics?: DifferentialStateRegenMetrics | null},
  {
    stateDifferentials,
    stateSnapshot,
  }: {stateDifferentials: BeaconStateDifferential[]; stateSnapshot: BeaconStateSnapshot}
): Promise<BeaconStateSnapshot> {
  let activeState: BeaconStateSnapshot = stateSnapshot;
  for (const intermediateStateDiff of stateDifferentials) {
    activeState = applyStateDifferential(modules, activeState, intermediateStateDiff);
  }
  return activeState;
}

export async function getStateDifferential(
  modules: {db: IBeaconDb; metrics?: DifferentialStateRegenMetrics | null},
  {slot}: {slot: Slot}
): Promise<BeaconStateDifferential | null> {
  const {db} = modules;
  const timer = modules.metrics?.loadDiffStateTime.startTimer();
  try {
    return await db.beaconStateDifferentialArchive.get(slot);
  } finally {
    timer?.();
  }
}

export async function getStateDifferentials(
  modules: {db: IBeaconDb; metrics?: DifferentialStateRegenMetrics | null},
  {slots}: {slots: Slot[]}
): Promise<BeaconStateDifferential[]> {
  const result: BeaconStateDifferential[] = [];

  for (const slot of slots) {
    const state = await getStateDifferential(modules, {slot});
    if (state !== undefined && state !== null) {
      result.push(state);
    }
  }

  return result;
}
