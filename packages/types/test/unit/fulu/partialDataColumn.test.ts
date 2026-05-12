import {describe, expect, it} from "vitest";
import {ssz} from "../../../src/index.js";

describe("PartialDataColumn SSZ types", () => {
  describe("PartialDataColumnHeader", () => {
    it("should serialize and deserialize default value", () => {
      const defaultValue = ssz.fulu.PartialDataColumnHeader.defaultValue();
      const serialized = ssz.fulu.PartialDataColumnHeader.serialize(defaultValue);
      const deserialized = ssz.fulu.PartialDataColumnHeader.deserialize(serialized);
      expect(ssz.fulu.PartialDataColumnHeader.equals(defaultValue, deserialized)).toBe(true);
    });

    it("should round-trip with populated fields", () => {
      const header = ssz.fulu.PartialDataColumnHeader.defaultValue();
      // Add a commitment
      header.kzgCommitments = [new Uint8Array(48).fill(0xab)];
      // Set a slot
      header.signedBlockHeader.message.slot = 42;

      const serialized = ssz.fulu.PartialDataColumnHeader.serialize(header);
      const deserialized = ssz.fulu.PartialDataColumnHeader.deserialize(serialized);

      expect(deserialized.kzgCommitments.length).toBe(1);
      expect(deserialized.signedBlockHeader.message.slot).toBe(42);
    });
  });

  describe("PartialDataColumnSidecar", () => {
    it("should serialize and deserialize with empty header list", () => {
      const sidecar = ssz.fulu.PartialDataColumnSidecar.defaultValue();
      const serialized = ssz.fulu.PartialDataColumnSidecar.serialize(sidecar);
      const deserialized = ssz.fulu.PartialDataColumnSidecar.deserialize(serialized);
      expect(deserialized.header.length).toBe(0);
      expect(deserialized.partialColumn.length).toBe(0);
    });

    it("should round-trip with header present and cells", () => {
      const sidecar = ssz.fulu.PartialDataColumnSidecar.defaultValue();

      // Add a header
      const header = ssz.fulu.PartialDataColumnHeader.defaultValue();
      header.kzgCommitments = [new Uint8Array(48).fill(0xcc)];
      sidecar.header = [header];

      // Add a cell and proof
      sidecar.cellsPresentBitmap = ssz.fulu.PartialDataColumnSidecar.fields.cellsPresentBitmap.defaultValue();
      sidecar.partialColumn = [new Uint8Array(2048).fill(0x01)];
      sidecar.kzgProofs = [new Uint8Array(48).fill(0x02)];

      const serialized = ssz.fulu.PartialDataColumnSidecar.serialize(sidecar);
      const deserialized = ssz.fulu.PartialDataColumnSidecar.deserialize(serialized);

      expect(deserialized.header.length).toBe(1);
      expect(deserialized.partialColumn.length).toBe(1);
      expect(deserialized.kzgProofs.length).toBe(1);
    });
  });

  describe("PartialDataColumnPartsMetadata", () => {
    it("should serialize and deserialize default value", () => {
      const defaultValue = ssz.fulu.PartialDataColumnPartsMetadata.defaultValue();
      const serialized = ssz.fulu.PartialDataColumnPartsMetadata.serialize(defaultValue);
      const deserialized = ssz.fulu.PartialDataColumnPartsMetadata.deserialize(serialized);
      expect(ssz.fulu.PartialDataColumnPartsMetadata.equals(defaultValue, deserialized)).toBe(true);
    });
  });
});
