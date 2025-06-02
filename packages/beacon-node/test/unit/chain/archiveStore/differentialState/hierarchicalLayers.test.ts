import {describe, expect, it} from "vitest";
import {HierarchicalLayers} from "../../../../../src/chain/archiveStore/differentialState/hierarchicalLayers.js";
import {HierarchicalLayersErrorCode} from "../../../../../src/chain/archiveStore/errors.js";
import {allLayerTests} from "../../../../fixtures/differentialState/hierarchicalLayers.js";

describe("HierarchicalLayers", () => {
  describe("fromString", () => {
    it("should create a HierarchicalLayers instance from a string", () => {
      const hierarchicalLayers = HierarchicalLayers.fromString("1,3,5,7");
      expect(hierarchicalLayers).toBeInstanceOf(HierarchicalLayers);
      expect(hierarchicalLayers.toString()).toEqual("1,3,5,7");
    });

    it("should throw an error for invalid string format", () => {
      expect(() => HierarchicalLayers.fromString("1,3,5,a")).toThrowLodestarError({
        code: HierarchicalLayersErrorCode.InvalidLayerEpoch,
      });
    });

    it("should throw an error for empty string", () => {
      expect(() => HierarchicalLayers.fromString("")).toThrowLodestarError({
        code: HierarchicalLayersErrorCode.EmptyEpochs,
      });
    });

    it("should throw an error for minimum epoch", () => {
      expect(() => HierarchicalLayers.fromString("1")).toThrowLodestarError({
        code: HierarchicalLayersErrorCode.MinLayers,
      });
    });

    it("should throw an error for negative layer epoch", () => {
      expect(() => HierarchicalLayers.fromString("1,3,5,-7")).toThrowLodestarError({
        code: HierarchicalLayersErrorCode.InvalidLayerEpoch,
      });
    });

    it("should throw an error for zero layer epoch", () => {
      expect(() => HierarchicalLayers.fromString("0,1,3,5")).toThrowLodestarError({
        code: HierarchicalLayersErrorCode.InvalidLayerEpoch,
      });
    });

    it("should throw an error for non-integer layer epoch", () => {
      expect(() => HierarchicalLayers.fromString("1,3,5,7.5")).toThrowLodestarError({
        code: HierarchicalLayersErrorCode.InvalidLayerEpoch,
      });
    });

    it("should throw an error for invalid order of epochs", () => {
      expect(() => HierarchicalLayers.fromString("5,3,7")).toThrowLodestarError({
        code: HierarchicalLayersErrorCode.InvalidOrder,
      });
    });
  });

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
    // As we are using `computeStartSlotAtEpoch` function so it will respect the current preset in the tests
    it.each(allLayerTests)("$title", ({slot, path, layers}) => {
      const snapshotSlot = path.at(0);
      const diffSlots = path.slice(1);

      const hierarchicalLayers = HierarchicalLayers.fromString(layers);
      expect(hierarchicalLayers.getArchiveLayers(slot)).toEqual({snapshotSlot, diffSlots});
    });
  });
});
