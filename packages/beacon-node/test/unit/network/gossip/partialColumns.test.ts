import {describe, expect, it} from "vitest";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {
  countColumnsInMetadata,
  decodePartsMetadata,
  encodePartsMetadata,
  isCompleteMetadata,
  validateColumnInMetadata,
  validatePartsMetadata,
} from "../../../../src/network/gossip/partialColumns.js";

describe("partialColumns utilities", () => {
  const PARTS_METADATA_SIZE = Math.ceil(NUMBER_OF_COLUMNS / 8);

  describe("encodePartsMetadata", () => {
    it("should encode empty indices to zero-filled metadata", () => {
      const metadata = encodePartsMetadata([]);
      expect(metadata.length).toBe(PARTS_METADATA_SIZE);
      expect(metadata.every((b) => b === 0)).toBe(true);
    });

    it("should encode single column index", () => {
      const metadata = encodePartsMetadata([0]);
      expect(metadata[0]).toBe(0b00000001);

      const metadata5 = encodePartsMetadata([5]);
      expect(metadata5[0]).toBe(0b00100000);

      const metadata8 = encodePartsMetadata([8]);
      expect(metadata8[1]).toBe(0b00000001);
    });

    it("should encode multiple column indices", () => {
      const metadata = encodePartsMetadata([0, 1, 2, 3]);
      expect(metadata[0]).toBe(0b00001111);
    });

    it("should handle column indices across byte boundaries", () => {
      const metadata = encodePartsMetadata([7, 8]);
      expect(metadata[0]).toBe(0b10000000);
      expect(metadata[1]).toBe(0b00000001);
    });
  });

  describe("decodePartsMetadata", () => {
    it("should decode empty metadata to empty indices", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      const indices = decodePartsMetadata(metadata);
      expect(indices).toEqual([]);
    });

    it("should decode single bit", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      metadata[0] = 0b00000001;
      const indices = decodePartsMetadata(metadata);
      expect(indices).toEqual([0]);
    });

    it("should decode multiple bits", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      metadata[0] = 0b00001111;
      const indices = decodePartsMetadata(metadata);
      expect(indices).toEqual([0, 1, 2, 3]);
    });

    it("should be inverse of encodePartsMetadata", () => {
      const originalIndices = [0, 5, 10, 63, 64, 127];
      const encoded = encodePartsMetadata(originalIndices);
      const decoded = decodePartsMetadata(encoded);
      expect(decoded).toEqual(originalIndices);
    });
  });

  describe("validatePartsMetadata", () => {
    it("should accept valid metadata", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      const result = validatePartsMetadata(metadata);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject wrong size metadata", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE + 1);
      const result = validatePartsMetadata(metadata);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid metadata size");
    });

    it("should reject too small metadata", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE - 1);
      const result = validatePartsMetadata(metadata);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid metadata size");
    });

    it("should accept valid full metadata", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE).fill(0xff);
      // If NUMBER_OF_COLUMNS is not a multiple of 8, we need to clear extra bits
      const remainingBits = NUMBER_OF_COLUMNS % 8;
      if (remainingBits > 0) {
        metadata[PARTS_METADATA_SIZE - 1] = (1 << remainingBits) - 1;
      }
      const result = validatePartsMetadata(metadata);
      expect(result.valid).toBe(true);
    });
  });

  describe("validateColumnInMetadata", () => {
    it("should accept column that is in metadata", () => {
      const metadata = encodePartsMetadata([5]);
      const result = validateColumnInMetadata(5, metadata);
      expect(result.valid).toBe(true);
    });

    it("should reject column that is not in metadata", () => {
      const metadata = encodePartsMetadata([5]);
      const result = validateColumnInMetadata(6, metadata);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not indicated");
    });

    it("should reject negative column index", () => {
      const metadata = encodePartsMetadata([0]);
      const result = validateColumnInMetadata(-1, metadata);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("out of range");
    });

    it("should reject column index >= NUMBER_OF_COLUMNS", () => {
      const metadata = encodePartsMetadata([0]);
      const result = validateColumnInMetadata(NUMBER_OF_COLUMNS, metadata);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("out of range");
    });
  });

  describe("countColumnsInMetadata", () => {
    it("should return 0 for empty metadata", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      expect(countColumnsInMetadata(metadata)).toBe(0);
    });

    it("should count single column", () => {
      const metadata = encodePartsMetadata([42]);
      expect(countColumnsInMetadata(metadata)).toBe(1);
    });

    it("should count multiple columns", () => {
      const indices = [0, 5, 10, 63, 64, 100, 127];
      const metadata = encodePartsMetadata(indices);
      expect(countColumnsInMetadata(metadata)).toBe(indices.length);
    });

    it("should count all columns when complete", () => {
      const allIndices = Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i);
      const metadata = encodePartsMetadata(allIndices);
      expect(countColumnsInMetadata(metadata)).toBe(NUMBER_OF_COLUMNS);
    });
  });

  describe("isCompleteMetadata", () => {
    it("should return false for empty metadata", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      expect(isCompleteMetadata(metadata)).toBe(false);
    });

    it("should return false for partial metadata", () => {
      const metadata = encodePartsMetadata([0, 1, 2]);
      expect(isCompleteMetadata(metadata)).toBe(false);
    });

    it("should return true for complete metadata", () => {
      const allIndices = Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i);
      const metadata = encodePartsMetadata(allIndices);
      expect(isCompleteMetadata(metadata)).toBe(true);
    });

    it("should return false when only last column is missing", () => {
      const indices = Array.from({length: NUMBER_OF_COLUMNS - 1}, (_, i) => i);
      const metadata = encodePartsMetadata(indices);
      expect(isCompleteMetadata(metadata)).toBe(false);
    });

    it("should return false when only first column is missing", () => {
      const indices = Array.from({length: NUMBER_OF_COLUMNS - 1}, (_, i) => i + 1);
      const metadata = encodePartsMetadata(indices);
      expect(isCompleteMetadata(metadata)).toBe(false);
    });
  });
});
