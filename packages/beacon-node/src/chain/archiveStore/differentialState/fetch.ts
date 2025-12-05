import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.ts";
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
  db: IBeaconDb,
  plan: StateRegenPlan,
  opts: {fallbackSnapshot?: boolean} = {}
): Promise<StateRegenArtifacts> {
  const snapshot = await getStateSnapshot({db}, {slot: plan.snapshotSlot, fallback: opts.fallbackSnapshot ?? false});

  if (!snapshot) {
    throw new Error(`Can not find state snapshot for slot=${plan.snapshotSlot}`);
  }

  const diffs: BeaconStateDifferential[] = [];
  const missingDiffs: Slot[] = [];

  for (const edge of plan.diffSlots) {
    const diff = await getStateDifferential({db}, {slot: edge});
    diff ? diffs.push(diff) : missingDiffs.push(edge);
  }

  return {snapshot, diffs, missingDiffs};
}
