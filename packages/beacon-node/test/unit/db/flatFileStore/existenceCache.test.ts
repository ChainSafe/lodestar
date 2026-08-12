import {describe, expect, it} from "vitest";
import {ExistenceCache} from "../../../../src/db/flatFileStore/existenceCache.js";

describe("ExistenceCache", () => {
  describe("column presence", () => {
    it("should track column files", () => {
      const cache = new ExistenceCache();

      cache.setColumnPresent(100, "0xabc");
      expect(cache.getColumnFileCount()).toBe(1);
      expect(cache.getColumnSlotsBefore(101)).toEqual([100]);

      cache.setColumnPresent(100, "0xabc");
      expect(cache.getColumnFileCount()).toBe(1);
    });

    it("should track multiple roots at a slot", () => {
      const cache = new ExistenceCache();

      cache.setColumnPresent(100, "0xabc");
      cache.setColumnPresent(100, "0xdef");
      expect(cache.getColumnFileCount()).toBe(2);

      cache.removeColumns(100, "0xabc");
      expect(cache.getColumnFileCount()).toBe(1);
    });

    it("should remove column files", () => {
      const cache = new ExistenceCache();

      cache.setColumnPresent(100, "0xabc");
      cache.removeColumns(100, "0xabc");
      expect(cache.getColumnFileCount()).toBe(0);
      expect(cache.getColumnSlotsBefore(101)).toEqual([100]);

      cache.removeColumnSlot(100);
      expect(cache.getColumnSlotsBefore(101)).toEqual([]);
    });
  });
});
