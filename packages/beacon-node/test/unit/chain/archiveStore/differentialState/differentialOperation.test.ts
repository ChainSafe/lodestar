import {describe, expect, it} from "vitest";
import {getDifferentialOperation} from "../../../../../src/chain/archiveStore/differentialState/differentialOperation.js";
import {HierarchicalLayers} from "../../../../../src/chain/archiveStore/differentialState/hierarchicalLayers.js";
import {allLayerTests} from "../../../../fixtures/differentialState/hierarchicalLayers.js";

describe("differential state / operations", () => {
  it.each(allLayerTests)("$title", ({slot, path, layers, blockReplay}) => {
    const hLayers = HierarchicalLayers.fromString(layers);

    const snapshotSlot = path[0];
    const diffSlots = path.slice(1);

    expect(getDifferentialOperation({layers: hLayers}, slot)).toEqual({snapshotSlot, diffSlots, blockReplay});
  });
});
