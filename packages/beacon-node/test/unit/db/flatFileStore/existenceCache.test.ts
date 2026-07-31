import {describe, expect, it} from "vitest";
import {ExistenceCache} from "../../../../src/db/flatFileStore/existenceCache.js";

describe("ExistenceCache", () => {
  describe("blob presence", () => {
    it("should track blob presence", () => {
      const cache = new ExistenceCache();

      expect(cache.getUniqueBlobRootForSlot(100)).toBeNull();

      cache.setBlobPresent(100, "0xabc");
      expect(cache.getUniqueBlobRootForSlot(100)).toBe("0xabc");
      expect(cache.getBlobFileCount()).toBe(1);
      expect(cache.getUniqueBlobRootForSlot(101)).toBeNull();

      cache.setBlobPresent(100, "0xabc");
      expect(cache.getBlobFileCount()).toBe(1);
    });

    it("should remove blob presence", () => {
      const cache = new ExistenceCache();

      cache.setBlobPresent(100, "0xabc");
      cache.removeBlobPresent(100, "0xabc");
      expect(cache.getUniqueBlobRootForSlot(100)).toBeNull();
      expect(cache.getBlobFileCount()).toBe(0);
      expect(cache.getBlobSlotsBefore(101)).toEqual([100]);

      cache.removeBlobSlot(100);
      expect(cache.getBlobSlotsBefore(101)).toEqual([]);
    });
  });

  describe("column presence", () => {
    it("should track column files", () => {
      const cache = new ExistenceCache();

      expect(cache.getUniqueColumnRootForSlot(100)).toBeNull();

      cache.setColumnPresent(100, "0xabc");
      expect(cache.getUniqueColumnRootForSlot(100)).toBe("0xabc");
      expect(cache.getColumnFileCount()).toBe(1);

      cache.setColumnPresent(100, "0xabc");
      expect(cache.getColumnFileCount()).toBe(1);
    });

    it("should resolve a root only when it is unique", () => {
      const cache = new ExistenceCache();

      cache.setColumnPresent(100, "0xabc");
      expect(cache.getUniqueColumnRootForSlot(100)).toBe("0xabc");
      cache.setColumnPresent(100, "0xdef");
      expect(cache.getUniqueColumnRootForSlot(100)).toBeNull();
    });

    it("should remove column files", () => {
      const cache = new ExistenceCache();

      cache.setColumnPresent(100, "0xabc");
      cache.removeColumns(100, "0xabc");
      expect(cache.getUniqueColumnRootForSlot(100)).toBeNull();
      expect(cache.getColumnFileCount()).toBe(0);
      expect(cache.getColumnSlotsBefore(101)).toEqual([100]);

      cache.removeColumnSlot(100);
      expect(cache.getColumnSlotsBefore(101)).toEqual([]);
    });
  });

  describe("slots before", () => {
    it("should enumerate blob and column slots independently", () => {
      const cache = new ExistenceCache();

      cache.setBlobPresent(100, "0xabc");
      cache.setBlobPresent(200, "0xdef");
      cache.setBlobPresent(300, "0xghi");

      cache.setColumnPresent(100, "0xabc");
      cache.setColumnPresent(300, "0xghi");

      expect(cache.getBlobSlotsBefore(200)).toEqual([100]);
      expect(cache.getColumnSlotsBefore(200)).toEqual([100]);
      expect(cache.getUniqueBlobRootForSlot(200)).toBe("0xdef");
      expect(cache.getUniqueBlobRootForSlot(300)).toBe("0xghi");
      expect(cache.getUniqueColumnRootForSlot(100)).toBe("0xabc");
      expect(cache.getUniqueColumnRootForSlot(300)).toBe("0xghi");

      cache.removeBlobSlot(100);
      expect(cache.getUniqueBlobRootForSlot(100)).toBeNull();
      expect(cache.getBlobFileCount()).toBe(2);
      expect(cache.getUniqueColumnRootForSlot(100)).toBe("0xabc");

      cache.removeColumnSlot(100);
      expect(cache.getUniqueColumnRootForSlot(100)).toBeNull();
      expect(cache.getColumnFileCount()).toBe(1);
      expect(cache.getUniqueColumnRootForSlot(300)).toBe("0xghi");
    });
  });
});
