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
      expect(cache.getBlobSlotsBefore(101)).toEqual([100]);

      cache.removeBlobSlot(100);
      expect(cache.getBlobSlotsBefore(101)).toEqual([]);
    });
  });

  describe("column presence", () => {
    it("should track column files", () => {
      const cache = new ExistenceCache();

      expect(cache.hasColumnPresent(100, "0xabc")).toBe(false);

      cache.setColumnPresent(100, "0xabc");
      expect(cache.hasColumnPresent(100, "0xabc")).toBe(true);
      expect(cache.hasColumnPresent(100, "0xdef")).toBe(false);
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
      expect(cache.hasColumnPresent(100, "0xabc")).toBe(false);
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
      expect(cache.hasBlobPresent(200, "0xdef")).toBe(true);
      expect(cache.hasBlobPresent(300, "0xghi")).toBe(true);
      expect(cache.hasColumnPresent(100, "0xabc")).toBe(true);
      expect(cache.hasColumnPresent(300, "0xghi")).toBe(true);

      cache.removeBlobSlot(100);
      expect(cache.hasBlobPresent(100, "0xabc")).toBe(false);
      expect(cache.hasColumnPresent(100, "0xabc")).toBe(true);

      cache.removeColumnSlot(100);
      expect(cache.hasColumnPresent(100, "0xabc")).toBe(false);
      expect(cache.hasColumnPresent(300, "0xghi")).toBe(true);
    });
  });
});
