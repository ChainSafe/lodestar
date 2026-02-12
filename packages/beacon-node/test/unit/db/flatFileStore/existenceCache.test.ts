import {describe, expect, it} from "vitest";
import {ExistenceCache} from "../../../../src/db/flatFileStore/existenceCache.js";

describe("ExistenceCache", () => {
  describe("blob presence", () => {
    it("should track blob presence", () => {
      const cache = new ExistenceCache();

      expect(cache.hasBlobPresent(100, "0xabc")).toBe(false);

      cache.setBlobPresent(100, "0xabc");
      expect(cache.hasBlobPresent(100, "0xabc")).toBe(true);
      expect(cache.hasBlobPresent(100, "0xdef")).toBe(false);
      expect(cache.hasBlobPresent(101, "0xabc")).toBe(false);
    });

    it("should remove blob presence", () => {
      const cache = new ExistenceCache();

      cache.setBlobPresent(100, "0xabc");
      cache.removeBlobPresent(100, "0xabc");
      expect(cache.hasBlobPresent(100, "0xabc")).toBe(false);
    });
  });

  describe("column bitmaps", () => {
    it("should track column presence", () => {
      const cache = new ExistenceCache();

      expect(cache.hasColumnPresent(100, "0xabc", 0)).toBe(false);

      cache.setColumnsPresent(100, "0xabc", [0, 5, 127]);
      expect(cache.hasColumnPresent(100, "0xabc", 0)).toBe(true);
      expect(cache.hasColumnPresent(100, "0xabc", 5)).toBe(true);
      expect(cache.hasColumnPresent(100, "0xabc", 127)).toBe(true);
      expect(cache.hasColumnPresent(100, "0xabc", 1)).toBe(false);
    });

    it("should accumulate columns", () => {
      const cache = new ExistenceCache();

      cache.setColumnsPresent(100, "0xabc", [0, 1]);
      cache.setColumnsPresent(100, "0xabc", [2, 3]);
      expect(cache.hasColumnPresent(100, "0xabc", 0)).toBe(true);
      expect(cache.hasColumnPresent(100, "0xabc", 3)).toBe(true);
    });

    it("should return bitmap", () => {
      const cache = new ExistenceCache();

      expect(cache.getColumnBitmap(100, "0xabc")).toBeNull();

      cache.setColumnsPresent(100, "0xabc", [0, 1]);
      const bitmap = cache.getColumnBitmap(100, "0xabc");
      expect(bitmap).toBe(3n); // bit 0 + bit 1
    });

    it("should remove columns", () => {
      const cache = new ExistenceCache();

      cache.setColumnsPresent(100, "0xabc", [0, 5]);
      cache.removeColumns(100, "0xabc");
      expect(cache.hasColumnPresent(100, "0xabc", 0)).toBe(false);
      expect(cache.getColumnBitmap(100, "0xabc")).toBeNull();
    });
  });

  describe("evictBelow", () => {
    it("should evict entries below minSlot", () => {
      const cache = new ExistenceCache();

      cache.setBlobPresent(100, "0xabc");
      cache.setBlobPresent(200, "0xdef");
      cache.setBlobPresent(300, "0xghi");

      cache.setColumnsPresent(100, "0xabc", [0]);
      cache.setColumnsPresent(300, "0xghi", [1]);

      cache.evictBelow(200);

      expect(cache.hasBlobPresent(100, "0xabc")).toBe(false);
      expect(cache.hasBlobPresent(200, "0xdef")).toBe(true);
      expect(cache.hasBlobPresent(300, "0xghi")).toBe(true);

      expect(cache.hasColumnPresent(100, "0xabc", 0)).toBe(false);
      expect(cache.hasColumnPresent(300, "0xghi", 1)).toBe(true);
    });
  });
});
