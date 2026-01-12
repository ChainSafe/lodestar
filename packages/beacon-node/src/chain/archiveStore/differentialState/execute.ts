import {computeEpochAtSlot} from "@lodestar/state-transition";
import {BeaconState, Slot} from "@lodestar/types";
import {formatBytes} from "@lodestar/utils";
import {StateRegenContext, applyStateRegenPlan} from "./apply.ts";
import {fetchStateRegenArtifacts} from "./fetch.ts";
import {HierarchicalLayers} from "./hierarchicalLayers.ts";
import {buildStateRegenPlan} from "./plan.ts";
import {BeaconStateDifferentialType, BeaconStateSnapshotType} from "./ssz.ts";
import {computeStateDifferential} from "./stateDifferential.ts";
import {beaconStateBytesToSnapshot, snapshotToBeaconState} from "./stateSnapshot.ts";

export async function regenerateState(
  ctx: StateRegenContext & {layers: HierarchicalLayers},
  target: Slot,
  opts?: {fallbackSnapshot?: boolean}
): Promise<BeaconState | null> {
  ctx.logger?.verbose("Regenerating state via state differential", {
    slot: target,
  });
  const regenTimer = ctx.metrics?.regenTime.startTimer();
  ctx.metrics?.regenRequestCount.inc();

  const plan = buildStateRegenPlan(ctx.layers, target);
  const artifacts = await fetchStateRegenArtifacts(ctx, plan, opts);
  const finalState = await applyStateRegenPlan(ctx, plan, artifacts);
  const state = snapshotToBeaconState(ctx, finalState);

  ctx.metrics?.regenSuccessCount.inc();
  regenTimer?.();

  return state;
}

export async function storeDifferentialState(
  ctx: StateRegenContext & {layers: HierarchicalLayers},
  slot: Slot,
  stateBytes: Uint8Array
): Promise<void> {
  const {logger, metrics, layers, db, config, codec} = ctx;
  const epoch = computeEpochAtSlot(slot);

  logger?.info("Storing historical state", {epoch, slot});
  const plan = buildStateRegenPlan(layers, slot);

  if (slot === plan.snapshotSlot) {
    const snapshot = beaconStateBytesToSnapshot({config}, slot, stateBytes);
    const snapshotBytes = BeaconStateSnapshotType.serialize(snapshot);

    metrics?.stateSnapshotSize.set(snapshotBytes.byteLength);
    await db.beaconStateSnapshotArchive.putBinary(slot, snapshotBytes);
    logger?.verbose("State stored as snapshot", {
      epoch,
      slot,
      stateSize: formatBytes(stateBytes.byteLength),
      snapshotSize: formatBytes(snapshotBytes.byteLength),
    });
    return;
  }

  const lastDiffSlot = plan.diffSlots.at(-1);
  if (slot === lastDiffSlot) {
    const artifacts = await fetchStateRegenArtifacts({db: ctx.db, metrics: ctx.metrics}, plan);
    const finalState = await applyStateRegenPlan(ctx, plan, artifacts);
    const diffState = await computeStateDifferential(
      {codec, config, metrics: ctx.metrics},
      config.getForkTypes(slot).BeaconState.deserialize(stateBytes),
      finalState
    );
    const diffStateBytes = BeaconStateDifferentialType.serialize(diffState);

    metrics?.stateDiffSize.set(diffStateBytes.byteLength);
    await db.beaconStateDifferentialArchive.putBinary(slot, diffStateBytes);
    logger?.verbose("State stored as differential", {
      epoch,
      slot,
      stateSize: formatBytes(stateBytes.byteLength),
      diffSize: formatBytes(diffStateBytes.byteLength),
    });
    return;
  }

  logger?.verbose("Skipping storage of state diff for block replay", {
    epoch,
    slot,
  });
}
