import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {describe, expect, it} from "vitest";
import {HierarchicalLayers, Layers} from "../../../../../src/chain/archiveStore/utils/hierarchicalLayers.js";

describe("HierarchicalLayers", () => {
  describe("toString", () => {
    it("should be same as initialized string", () => {
      const hierarchicalLayers = HierarchicalLayers.fromString("1,3,5,7");
      expect(hierarchicalLayers.toString()).toEqual("1,3,5,7");
    });
  });

  describe("totalLayers", () => {
    it("should return valid number of layers", () => {
      const hierarchicalLayers = HierarchicalLayers.fromString("1,3,5,7");

      expect(hierarchicalLayers.totalLayers).toEqual(4);
    });
  });

  describe("getArchiveLayers", () => {
    // Considering that there are 8 slots per epoch and we are using 1,3,5,7 epoch as layers
    const overlappingEpochs: {title: string; slot: number; output: Layers}[] = [
      {title: "genesis slot", slot: 0, output: {snapshotSlot: 0, diffSlots: []}},
      {title: "slot after genesis slot", slot: 5, output: {snapshotSlot: 0, diffSlots: []}},
      {
        title: "slot before the epoch 1",
        slot: computeStartSlotAtEpoch(1) - 1,
        output: {snapshotSlot: 0, diffSlots: []},
      },
      {
        title: "slot at epoch 1",
        slot: computeStartSlotAtEpoch(1),
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(1)]},
      },
      {
        title: "slot after epoch 1",
        slot: computeStartSlotAtEpoch(1) + 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(1)]},
      },
      {
        title: "slot before epoch 2",
        slot: computeStartSlotAtEpoch(2) - 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(1)]},
      },
      {
        title: "slot at epoch 2",
        slot: computeStartSlotAtEpoch(2),
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(2)]},
      },
      {
        title: "slot after epoch 2",
        slot: computeStartSlotAtEpoch(2) + 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(2)]},
      },
      {
        title: "slot before epoch 3",
        slot: computeStartSlotAtEpoch(3) - 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(2)]},
      },
      {
        title: "slot at epoch 3",
        slot: computeStartSlotAtEpoch(3),
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(3)]},
      },
      {
        title: "slot after epoch 3",
        slot: computeStartSlotAtEpoch(3) + 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(3)]},
      },
      // Snapshot epoch
      {
        title: "slot before epoch 7",
        slot: computeStartSlotAtEpoch(7) - 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(6)]},
      },
      {
        title: "slot at epoch 7",
        slot: computeStartSlotAtEpoch(7),
        output: {snapshotSlot: computeStartSlotAtEpoch(7), diffSlots: []},
      },
      {
        title: "slot after epoch 7",
        slot: computeStartSlotAtEpoch(7) + 1,
        output: {snapshotSlot: computeStartSlotAtEpoch(7), diffSlots: []},
      },
      // An epoch after first snapshot
      {
        title: "slot before epoch 8",
        slot: computeStartSlotAtEpoch(8) - 1,
        output: {snapshotSlot: computeStartSlotAtEpoch(7), diffSlots: []},
      },
      {
        title: "slot at epoch 8",
        slot: computeStartSlotAtEpoch(8),
        output: {snapshotSlot: computeStartSlotAtEpoch(7), diffSlots: [computeStartSlotAtEpoch(8)]},
      },
      {
        title: "slot after epoch 8",
        slot: computeStartSlotAtEpoch(8) + 1,
        output: {snapshotSlot: computeStartSlotAtEpoch(7), diffSlots: [computeStartSlotAtEpoch(8)]},
      },
    ];

    it.each(overlappingEpochs)("$title", ({slot, output}) => {
      const hierarchicalLayers = HierarchicalLayers.fromString("1,3,5,7");

      expect(hierarchicalLayers.getArchiveLayers(slot)).toEqual(output);
    });

    // Considering that there are 8 slots per epoch and we are using 3,5,7 epoch as layers
    const nonOverlappingEpochs: {title: string; slot: number; output: Layers}[] = [
      {title: "genesis slot", slot: 0, output: {snapshotSlot: 0, diffSlots: []}},
      {title: "slot after genesis slot", slot: 5, output: {snapshotSlot: 0, diffSlots: []}},
      {
        title: "one slot before first diff layer",
        slot: computeStartSlotAtEpoch(3) - 1,
        output: {snapshotSlot: 0, diffSlots: []},
      },
      {
        title: "at slot of first diff layer",
        slot: computeStartSlotAtEpoch(3),
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(3)]},
      },
      {
        title: "after slot of first diff layer",
        slot: computeStartSlotAtEpoch(3) + 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(3)]},
      },
      {
        title: "one slot before second diff layer",
        slot: computeStartSlotAtEpoch(5) - 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(3)]},
      },
      {
        title: "at slot of second diff layer",
        slot: computeStartSlotAtEpoch(5),
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(5)]},
      },
      {
        title: "after slot of second diff layer",
        slot: computeStartSlotAtEpoch(5) + 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(5)]},
      },
      {
        title: "one slot before first snapshot",
        slot: computeStartSlotAtEpoch(7) - 1,
        output: {snapshotSlot: 0, diffSlots: [computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(6)]},
      },
      {
        title: "at slot of second diff layer",
        slot: computeStartSlotAtEpoch(7),
        output: {snapshotSlot: computeStartSlotAtEpoch(7), diffSlots: []},
      },
      {
        title: "after slot of second diff layer",
        slot: computeStartSlotAtEpoch(7) + 1,
        output: {snapshotSlot: computeStartSlotAtEpoch(7), diffSlots: []},
      },
    ];

    it.each(nonOverlappingEpochs)("$title", ({slot, output}) => {
      const hierarchicalLayers = HierarchicalLayers.fromString("3,5,7");

      expect(hierarchicalLayers.getArchiveLayers(slot)).toEqual(output);
    });
  });
});
