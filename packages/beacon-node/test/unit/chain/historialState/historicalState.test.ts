import {describe, it, expect, beforeEach} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {HierarchicalLayers} from "../../../../src/chain/historicalState/utils/hierarchicalLayers.js";
import {HistoricalStateSlotType} from "../../../../src/chain/historicalState/types.js";
import {StateArchiveMode} from "../../../../src/chain/archiver/index.js";

const layer0 = 5;
const layer1 = 3;
const layer2 = 2;
const layer3 = 1;

describe("HierarchicalLayers", () => {
  const layers = `${layer3},${layer2},${layer1},${layer0}`;
  let hierarchicalLayers: HierarchicalLayers;

  beforeEach(() => {
    hierarchicalLayers = HierarchicalLayers.fromString(layers);
  });

  it("should have correct total layers", () => {
    expect(hierarchicalLayers.totalLayers).toEqual(4);
  });

  describe("getArchiveStrategy", () => {
    it("should return snapshot strategy for slot 0", () => {
      expect(hierarchicalLayers.getSlotType(0, StateArchiveMode.Differential)).toEqual(
        HistoricalStateSlotType.Snapshot
      );
    });

    it.each([0, layer0 * SLOTS_PER_EPOCH, layer0 * SLOTS_PER_EPOCH * 2, layer0 * SLOTS_PER_EPOCH * 3])(
      "should return snapshot strategy for slot %i",
      (slot) => {
        expect(hierarchicalLayers.getSlotType(slot, StateArchiveMode.Frequency)).toEqual(
          HistoricalStateSlotType.Snapshot
        );
      }
    );

    it.each(
      [
        // Every 2nd epoch
        [layer1 * SLOTS_PER_EPOCH, layer1 * SLOTS_PER_EPOCH * 2, layer1 * SLOTS_PER_EPOCH * 3],
        // Every 4th epoch
        [layer2 * SLOTS_PER_EPOCH, layer2 * SLOTS_PER_EPOCH * 2, layer2 * SLOTS_PER_EPOCH * 3],
        // Every 8th Epoch
        [layer3 * SLOTS_PER_EPOCH, layer3 * SLOTS_PER_EPOCH * 3],
      ].flat()
    )("should return diff strategy for slot %i", (slot) => {
      expect(hierarchicalLayers.getSlotType(slot, StateArchiveMode.Differential)).toEqual(HistoricalStateSlotType.Diff);
    });

    it.each(
      [
        // Every 2nd epoch + few extra slots
        [layer1 * SLOTS_PER_EPOCH + 2, layer1 * SLOTS_PER_EPOCH * 2 + 2, layer1 * SLOTS_PER_EPOCH * 3 + 4],
        // Every 4th epoch + few extra slots
        [layer2 * SLOTS_PER_EPOCH + 2, layer2 * SLOTS_PER_EPOCH * 2 + 2, layer2 * SLOTS_PER_EPOCH * 3 + 5],
        // Every 8th Epoch + few extra slots
        [layer3 * SLOTS_PER_EPOCH + 1, layer3 * SLOTS_PER_EPOCH * 3 + 3],
      ].flat()
    )("should return block replay strategy for slot %i", (slot) => {
      expect(hierarchicalLayers.getSlotType(slot, StateArchiveMode.Differential)).toEqual(
        HistoricalStateSlotType.BlockReplay
      );
    });
  });

  describe("getArchiveLayers", () => {
    it("should return one layer for genesis slot", () => {
      expect(hierarchicalLayers.getArchiveLayers(0)).toEqual([0]);
    });

    // Please see following [doc](../../../../docs/pages/contribution/advance-topics/historical-state-regen.md) for understanding of these fixtures
    it.each([
      {slot: 2, path: [0]},
      {slot: 7, path: [0]},
      {slot: 8, path: [0, 8]},
      {slot: 10, path: [0, 8]},
      {slot: 18, path: [0, 16]},
      {slot: 22, path: [0, 16]},
      {slot: 25, path: [0, 24]},
      {slot: 31, path: [0, 24]},
      {slot: 33, path: [0, 24, 32]},
      {slot: 38, path: [0, 24, 32]},
      {slot: 40, path: [40]},
      {slot: 42, path: [40]},
    ])("should return valid layers for slot $slot", ({slot, path}) => {
      expect(hierarchicalLayers.getArchiveLayers(slot)).toEqual(path);
    });
  });
});
