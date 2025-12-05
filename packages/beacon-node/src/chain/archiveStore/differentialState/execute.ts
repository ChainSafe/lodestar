import {BeaconState, Slot} from "@lodestar/types";
import {StateRegenContext, applyStateRegenPlan} from "./apply.ts";
import {fetchStateRegenArtifacts} from "./fetch.ts";
import {HierarchicalLayers} from "./hierarchicalLayers.ts";
import {buildStateRegenPlan} from "./plan.ts";
import {snapshotToBeaconState} from "./stateSnapshot.ts";

export async function regenerateState(
  ctx: StateRegenContext & {layers: HierarchicalLayers},
  target: Slot,
  opts?: {fallbackSnapshot?: boolean}
): Promise<BeaconState | null> {
  ctx.logger?.verbose("Regenerating state via state differential", {
    slot: target,
  });

  const plan = buildStateRegenPlan(ctx.layers, target);
  const artifacts = await fetchStateRegenArtifacts(ctx.db, plan, opts);
  const finalState = await applyStateRegenPlan(ctx, plan, artifacts);

  return snapshotToBeaconState(ctx, finalState);
}
