import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {beforeEach, describe, expect, it} from "vitest";
import {DifferentialArchiveStrategy} from "../../../../../src/chain/archiveStore/interface.js";
import {DifferentialLayers} from "../../../../../src/chain/archiveStore/utils/differentialLayers.js";

const layer0 = 5;
const layer1 = 3;
const layer2 = 2;
const layer3 = 1;

describe("DifferentialLayers", () => {
  const layers = `${layer3},${layer2},${layer1},${layer0}`;
  let diffLayers: DifferentialLayers;

  beforeEach(() => {
    diffLayers = new DifferentialLayers(layers);
  });

  it("should have correct total layers", () => {
    expect(diffLayers.totalLayers).toEqual(4);
  });

  describe("getArchiveStrategy", () => {
    it("should return snapshot strategy for slot 0", () => {
      expect(diffLayers.getArchiveStrategy(0)).toEqual(DifferentialArchiveStrategy.Snapshot);
    });

    it.each([0, layer0 * SLOTS_PER_EPOCH, layer0 * SLOTS_PER_EPOCH * 2, layer0 * SLOTS_PER_EPOCH * 3])(
      "should return snapshot strategy for slot %i",
      (slot) => {
        expect(diffLayers.getArchiveStrategy(slot)).toEqual(DifferentialArchiveStrategy.Snapshot);
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
      expect(diffLayers.getArchiveStrategy(slot)).toEqual(DifferentialArchiveStrategy.Diff);
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
      expect(diffLayers.getArchiveStrategy(slot)).toEqual(DifferentialArchiveStrategy.BlockReplay);
    });
  });

  describe("getOperation", () => {
    it("should return one layer for genesis slot", () => {
      expect(diffLayers.getOperation(0)).toEqual({snapshotSlot: 0, diffSlots: []});
    });

    // Please see following [doc](../../../../docs/pages/contribution/advance-topics/historical-state-regen.md) for understanding of these fixtures
    it.each([
      {slot: 2, operation: {snapshotSlot: 0, diffSlots: [], blockReplay: {fromSlot: 1, toSlot: 2}}},
      {slot: 7, operation: {snapshotSlot: 0, diffSlots: [], blockReplay: {fromSlot: 1, toSlot: 7}}},
      {slot: 8, operation: {snapshotSlot: 0, diffSlots: [8]}},
      {slot: 10, operation: {snapshotSlot: 0, diffSlots: [8], blockReplay: {fromSlot: 9, toSlot: 10}}},
      {slot: 18, operation: {snapshotSlot: 0, diffSlots: [16], blockReplay: {fromSlot: 17, toSlot: 18}}},
      {slot: 22, operation: {snapshotSlot: 0, diffSlots: [16], blockReplay: {fromSlot: 17, toSlot: 22}}},
      {slot: 25, operation: {snapshotSlot: 0, diffSlots: [24], blockReplay: {fromSlot: 25, toSlot: 25}}},
      {slot: 31, operation: {snapshotSlot: 0, diffSlots: [24], blockReplay: {fromSlot: 25, toSlot: 31}}},
      {slot: 33, operation: {snapshotSlot: 0, diffSlots: [24, 32], blockReplay: {fromSlot: 33, toSlot: 33}}},
      {slot: 38, operation: {snapshotSlot: 0, diffSlots: [24, 32], blockReplay: {fromSlot: 33, toSlot: 38}}},
      {slot: 40, operation: {snapshotSlot: 40, diffSlots: []}},
      {slot: 42, operation: {snapshotSlot: 40, diffSlots: [], blockReplay: {fromSlot: 41, toSlot: 42}}},
    ])("should return valid layers for slot $slot", ({slot, operation}) => {
      expect(diffLayers.getOperation(slot)).toEqual(operation);
    });
  });
});
