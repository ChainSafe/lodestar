import {ChainForkConfig} from "@lodestar/config";
import {BeaconState, Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/interface.js";
import {DifferentialStateRegenMetrics} from "./metrics.ts";
import {BeaconStateSnapshot} from "./ssz.js";

/**
 * @internal
 */
export function snapshotToBeaconState(
  modules: {config: ChainForkConfig},
  stateSnapshot: BeaconStateSnapshot
): BeaconState {
  const {config} = modules;
  const target = config.getForkTypes(stateSnapshot.slot).BeaconState.deserialize(stateSnapshot.stateBytes);
  const targetBalances = config.getForkTypes(stateSnapshot.slot).Balances.deserialize(stateSnapshot.balancesBytes);
  target.balances = targetBalances;

  if (target.slot !== stateSnapshot.slot) {
    throw new Error(`Invalid slot in differential state: expected ${stateSnapshot.slot}, got ${target.slot}`);
  }

  return target;
}

/**
 * @internal
 */
export function snapshotToBeaconStateBytes(
  modules: {config: ChainForkConfig},
  stateSnapshot: BeaconStateSnapshot
): Uint8Array {
  const {config} = modules;
  const state = snapshotToBeaconState(modules, stateSnapshot);

  return config.getForkTypes(state.slot).BeaconState.serialize(state);
}

/**
 * @internal
 */
export function beaconStateToSnapshot(modules: {config: ChainForkConfig}, base: BeaconState): BeaconStateSnapshot {
  const {config} = modules;
  const state = config.getForkTypes(base.slot).BeaconState.clone(base);

  const balances = [...state.balances];
  state.balances = [];
  const stateBytes = config.getForkTypes(base.slot).BeaconState.serialize(state);
  const balancesBytes = config.getForkTypes(base.slot).Balances.serialize(balances);

  return {
    slot: base.slot,
    stateBytes,
    balancesBytes,
  };
}

export function beaconStateBytesToSnapshot(
  modules: {config: ChainForkConfig},
  slot: Slot,
  stateBytes: Uint8Array
): BeaconStateSnapshot {
  const {config} = modules;

  const state = config.getForkTypes(slot).BeaconState.deserialize(stateBytes);

  return beaconStateToSnapshot(modules, state);
}

export async function getStateSnapshot(
  modules: {db: IBeaconDb; metrics?: DifferentialStateRegenMetrics | null},
  {slot, fallback}: {slot: Slot; fallback: boolean}
): Promise<BeaconStateSnapshot | null> {
  const {db} = modules;

  const timer = modules.metrics?.loadSnapshotStateTime.startTimer();
  const state = await db.beaconStateSnapshotArchive.get(slot);
  timer?.();

  if (state) return state;
  if (!state && !fallback) return null;

  // There is a possibility that node is started with checkpoint and initial snapshot
  // is not persisted on expected slot
  const lastSnapshotSlot = await db.beaconStateSnapshotArchive.lastKey();
  if (lastSnapshotSlot && lastSnapshotSlot < slot) {
    return getStateSnapshot(modules, {slot: lastSnapshotSlot, fallback});
  }

  return null;
}
