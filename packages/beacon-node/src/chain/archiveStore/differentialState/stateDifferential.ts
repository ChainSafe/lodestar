import {ChainForkConfig} from "@lodestar/config";
import {BeaconState, Slot} from "@lodestar/types";
import {Logger, formatBytes} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {IStateDiffCodec} from "../interface.js";
import {DifferentialStateRegenMetrics} from "./metrics.ts";
import {BeaconStateDifferential, BeaconStateSnapshot} from "./ssz.js";

/**
 * Compute the differential state between a base state and a target state view
 */
export function computeStateDifferential(
  modules: {codec: IStateDiffCodec; config: ChainForkConfig; metrics?: DifferentialStateRegenMetrics},
  base: BeaconState,
  target: BeaconStateSnapshot
): BeaconStateDifferential {
  const {codec, config} = modules;
  const state = config.getForkTypes(base.slot).BeaconState.clone(base);

  const balances = [...state.balances];
  state.balances = [];

  const timer = modules.metrics?.computeDiffStateTime.startTimer();
  const stateDiffBytes = codec.compute(config.getForkTypes(base.slot).BeaconState.serialize(base), target.stateBytes);
  const balancesDiffBytes = codec.compute(
    config.getForkTypes(base.slot).Balances.serialize(balances),
    target.balancesBytes
  );
  timer?.();

  return {
    slot: target.slot,
    baseSlot: state.slot,
    stateDiffBytes,
    balancesDiffBytes,
  };
}

/**
 * Apply a differential state to a base state view
 */
export function applyStateDifferential(
  modules: {codec: IStateDiffCodec; logger?: Logger; metrics?: DifferentialStateRegenMetrics},
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

  try {
    const timer = modules.metrics?.applyDiffStateTime.startTimer();
    const stateBytes = codec.apply(base.stateBytes, diff.stateDiffBytes);
    const balancesBytes = codec.apply(base.balancesBytes, diff.balancesDiffBytes);
    timer?.();

    return {
      slot: diff.slot,
      stateBytes,
      balancesBytes,
    };
  } catch (error) {
    logger?.error("Failed to apply state differential", logInfo);
    throw error;
  }
}

export async function replayStateDifferentials(
  modules: {codec: IStateDiffCodec; logger?: Logger},
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
  modules: {db: IBeaconDb; metrics?: DifferentialStateRegenMetrics},
  {slot}: {slot: Slot}
): Promise<BeaconStateDifferential | null> {
  const {db} = modules;
  const timer = modules.metrics?.loadDiffStateTime.startTimer();
  const state = await db.beaconStateDifferentialArchive.get(slot);
  timer?.();
  return state;
}

export async function getStateDifferentials(
  modules: {db: IBeaconDb},
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
