import {describe, expect, it} from "vitest";
import {HierarchicalLayers} from "../../../../../src/chain/archiveStore/differentialState/hierarchicalLayers.ts";
import {buildStateRegenPlan} from "../../../../../src/chain/archiveStore/differentialState/plan.ts";
import {allLayerTests} from "../../../../fixtures/differentialState/hierarchicalLayers.ts";

describe("differential state / plan", () => {
  it.each(allLayerTests)("$title", ({slot, path, layers, blockReplay}) => {
    const hLayers = HierarchicalLayers.fromString(layers);

    const snapshotSlot = path[0];
    const diffSlots = path.slice(1);

    const plan = buildStateRegenPlan(hLayers, slot);

    expect(plan).toEqual({
      snapshotSlot,
      diffSlots,
      blockReplay,
      targetSlot: slot,
    });
  });
});
