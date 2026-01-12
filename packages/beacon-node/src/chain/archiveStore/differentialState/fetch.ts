import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.ts";
import {DiffStateRegenErrorType, DifferentialStateRegenMetrics} from "./metrics.ts";
import {StateRegenPlan} from "./plan.ts";
import {BeaconStateDifferential, BeaconStateSnapshot} from "./ssz.ts";
import {getStateDifferential} from "./stateDifferential.ts";
import {getStateSnapshot} from "./stateSnapshot.ts";

export type StateRegenArtifacts = {
  snapshot: BeaconStateSnapshot;
  diffs: BeaconStateDifferential[];
  missingDiffs: Slot[];
};

export async function fetchStateRegenArtifacts(
  modules: {db: IBeaconDb; metrics?: DifferentialStateRegenMetrics | null},
  plan: StateRegenPlan,
  opts: {fallbackSnapshot?: boolean} = {}
): Promise<StateRegenArtifacts> {
  const snapshot = await getStateSnapshot(modules, {
    slot: plan.snapshotSlot,
    fallback: opts.fallbackSnapshot ?? false,
  }).catch((err) => {
    modules.metrics?.regenErrorCount.inc({reason: DiffStateRegenErrorType.loadSnapshotState});
    throw err;
  });

  if (!snapshot) {
    modules.metrics?.regenErrorCount.inc({reason: DiffStateRegenErrorType.loadSnapshotState});
    throw new Error(`Can not find state snapshot for slot=${plan.snapshotSlot}`);
  }

  const diffs: BeaconStateDifferential[] = [];
  const missingDiffs: Slot[] = [];

  for (const edge of plan.diffSlots) {
    const diff = await getStateDifferential(modules, {slot: edge}).catch((err) => {
      modules.metrics?.regenErrorCount.inc({reason: DiffStateRegenErrorType.loadDiffState});
      throw err;
    });
    diff ? diffs.push(diff) : missingDiffs.push(edge);
  }

  if (plan.blockReplay && diffs.at(-1)?.slot !== plan.blockReplay.fromSlot - 1) {
    modules.metrics?.regenErrorCount.inc({reason: DiffStateRegenErrorType.loadDiffState});
    throw new Error(`Can not replay blocks due to missing state diffs ${missingDiffs.join(",")}`);
  }

  return {snapshot, diffs, missingDiffs};
}
