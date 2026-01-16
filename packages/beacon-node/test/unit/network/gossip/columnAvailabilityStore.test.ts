import {describe, it, expect, beforeEach, vi, afterEach} from "vitest";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {InMemoryColumnAvailabilityStore} from "../../../../src/network/gossip/columnAvailabilityStore.js";

describe("InMemoryColumnAvailabilityStore", () => {
  let store: InMemoryColumnAvailabilityStore;

  // Create different block roots for testing
  const createBlockRoot = (seed: number): Uint8Array => {
    const root = new Uint8Array(32);
    root.fill(seed);
    return root;
  };

  const blockRoot = createBlockRoot(1);

  beforeEach(() => {
    store = new InMemoryColumnAvailabilityStore();
  });

  describe("hasColumn", () => {
    it("should return false for unknown block root", () => {
      expect(store.hasColumn(blockRoot, 0)).toBe(false);
    });

    it("should return false for column that has not been marked", () => {
      store.markColumnAvailable(blockRoot, 0);
      expect(store.hasColumn(blockRoot, 1)).toBe(false);
    });

    it("should return true for column that has been marked", () => {
      store.markColumnAvailable(blockRoot, 5);
      expect(store.hasColumn(blockRoot, 5)).toBe(true);
    });

    it("should handle columns across byte boundaries", () => {
      // Column 7 is the last bit of byte 0
      store.markColumnAvailable(blockRoot, 7);
      expect(store.hasColumn(blockRoot, 7)).toBe(true);

      // Column 8 is the first bit of byte 1
      store.markColumnAvailable(blockRoot, 8);
      expect(store.hasColumn(blockRoot, 8)).toBe(true);

      // Other columns should still be false
      expect(store.hasColumn(blockRoot, 6)).toBe(false);
      expect(store.hasColumn(blockRoot, 9)).toBe(false);
    });

    it("should handle high column indices", () => {
      // Test with column at the upper end of valid range
      const highColumn = NUMBER_OF_COLUMNS - 1;
      store.markColumnAvailable(blockRoot, highColumn);
      expect(store.hasColumn(blockRoot, highColumn)).toBe(true);
    });
  });

  describe("markColumnAvailable", () => {
    it("should track column availability", () => {
      expect(store.hasColumn(blockRoot, 0)).toBe(false);

      store.markColumnAvailable(blockRoot, 0);
      expect(store.hasColumn(blockRoot, 0)).toBe(true);
      expect(store.hasColumn(blockRoot, 1)).toBe(false);
    });

    it("should handle marking the same column multiple times (idempotent)", () => {
      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 0);

      expect(store.hasColumn(blockRoot, 0)).toBe(true);
      expect(store.getColumnCount(blockRoot)).toBe(1);
    });

    it("should track columns independently for different block roots", () => {
      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);

      store.markColumnAvailable(root1, 0);
      store.markColumnAvailable(root2, 5);

      expect(store.hasColumn(root1, 0)).toBe(true);
      expect(store.hasColumn(root1, 5)).toBe(false);
      expect(store.hasColumn(root2, 0)).toBe(false);
      expect(store.hasColumn(root2, 5)).toBe(true);
    });
  });

  describe("getColumnCount", () => {
    it("should return 0 for unknown block root", () => {
      expect(store.getColumnCount(blockRoot)).toBe(0);
    });

    it("should return correct count after marking columns", () => {
      expect(store.getColumnCount(blockRoot)).toBe(0);

      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 5);
      store.markColumnAvailable(blockRoot, 127);

      expect(store.getColumnCount(blockRoot)).toBe(3);
    });

    it("should not double count columns marked multiple times", () => {
      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 0);

      expect(store.getColumnCount(blockRoot)).toBe(1);
    });

    it("should count all columns when all are marked", () => {
      for (let i = 0; i < NUMBER_OF_COLUMNS; i++) {
        store.markColumnAvailable(blockRoot, i);
      }
      expect(store.getColumnCount(blockRoot)).toBe(NUMBER_OF_COLUMNS);
    });
  });

  describe("getAvailableColumns", () => {
    it("should return null for unknown block root", () => {
      expect(store.getAvailableColumns(blockRoot)).toBeNull();
    });

    it("should return bitmap with correct bits set", () => {
      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 2);

      const columns = store.getAvailableColumns(blockRoot);
      expect(columns).not.toBeNull();
      // Bits 0 and 2 should be set = 0b00000101 = 5
      expect(columns![0]).toBe(0b00000101);
    });

    it("should return independent copies for different blocks", () => {
      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);

      store.markColumnAvailable(root1, 0);
      store.markColumnAvailable(root2, 1);

      const cols1 = store.getAvailableColumns(root1);
      const cols2 = store.getAvailableColumns(root2);

      expect(cols1![0]).toBe(0b00000001);
      expect(cols2![0]).toBe(0b00000010);
    });
  });

  describe("hasCustodyColumns", () => {
    it("should return true for empty custody columns list", () => {
      // Edge case: no custody columns required
      expect(store.hasCustodyColumns(blockRoot, [])).toBe(true);
    });

    it("should return false when no columns are available", () => {
      const custodyColumns = [0, 5, 10];
      expect(store.hasCustodyColumns(blockRoot, custodyColumns)).toBe(false);
    });

    it("should return false when only some custody columns are available", () => {
      const custodyColumns = [0, 5, 10];

      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 5);
      expect(store.hasCustodyColumns(blockRoot, custodyColumns)).toBe(false);
    });

    it("should return true when all custody columns are available", () => {
      const custodyColumns = [0, 5, 10];

      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 5);
      store.markColumnAvailable(blockRoot, 10);
      expect(store.hasCustodyColumns(blockRoot, custodyColumns)).toBe(true);
    });

    it("should return true when more than custody columns are available", () => {
      const custodyColumns = [0, 5];

      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 5);
      store.markColumnAvailable(blockRoot, 10);
      store.markColumnAvailable(blockRoot, 20);

      expect(store.hasCustodyColumns(blockRoot, custodyColumns)).toBe(true);
    });
  });

  describe("pruneBlock", () => {
    it("should remove all tracking for a block", () => {
      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 5);
      expect(store.hasColumn(blockRoot, 0)).toBe(true);
      expect(store.getColumnCount(blockRoot)).toBe(2);

      store.pruneBlock(blockRoot);

      expect(store.hasColumn(blockRoot, 0)).toBe(false);
      expect(store.getColumnCount(blockRoot)).toBe(0);
      expect(store.getAvailableColumns(blockRoot)).toBeNull();
    });

    it("should not affect other blocks when pruning", () => {
      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);

      store.markColumnAvailable(root1, 0);
      store.markColumnAvailable(root2, 5);

      store.pruneBlock(root1);

      expect(store.hasColumn(root1, 0)).toBe(false);
      expect(store.hasColumn(root2, 5)).toBe(true);
    });

    it("should handle pruning non-existent block gracefully", () => {
      // Should not throw
      store.pruneBlock(createBlockRoot(99));
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest block when at capacity", () => {
      const smallStore = new InMemoryColumnAvailabilityStore({maxBlocks: 2});

      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);
      const root3 = createBlockRoot(3);

      smallStore.markColumnAvailable(root1, 0);
      smallStore.markColumnAvailable(root2, 0);

      // At this point we have 2 blocks (at capacity)
      expect(smallStore.hasColumn(root1, 0)).toBe(true);
      expect(smallStore.hasColumn(root2, 0)).toBe(true);

      // Adding a third block should evict root1 (oldest)
      smallStore.markColumnAvailable(root3, 0);

      expect(smallStore.hasColumn(root1, 0)).toBe(false);
      expect(smallStore.hasColumn(root2, 0)).toBe(true);
      expect(smallStore.hasColumn(root3, 0)).toBe(true);
    });

    it("should update lastUpdated when marking columns on existing block", async () => {
      // Note: evictIfNeeded() only runs when adding a NEW block (state === undefined).
      // So updating an existing block's columns updates lastUpdated but doesn't trigger eviction.
      // We need to force time differences to test LRU behavior properly.
      vi.useFakeTimers();

      const smallStore = new InMemoryColumnAvailabilityStore({maxBlocks: 2});

      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);
      const root3 = createBlockRoot(3);

      // Add first block at time 0
      smallStore.markColumnAvailable(root1, 0);

      // Advance time and add second block
      vi.advanceTimersByTime(1000);
      smallStore.markColumnAvailable(root2, 0);

      // Advance time and touch root1 - this updates its lastUpdated
      vi.advanceTimersByTime(1000);
      smallStore.markColumnAvailable(root1, 1);

      // Now add root3 - root2 should be evicted (it has oldest lastUpdated)
      vi.advanceTimersByTime(1000);
      smallStore.markColumnAvailable(root3, 0);

      expect(smallStore.hasColumn(root1, 0)).toBe(true);
      expect(smallStore.hasColumn(root1, 1)).toBe(true);
      expect(smallStore.hasColumn(root2, 0)).toBe(false);
      expect(smallStore.hasColumn(root3, 0)).toBe(true);

      vi.useRealTimers();
    });

    it("should handle single block capacity", () => {
      const singleStore = new InMemoryColumnAvailabilityStore({maxBlocks: 1});

      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);

      singleStore.markColumnAvailable(root1, 0);
      expect(singleStore.hasColumn(root1, 0)).toBe(true);

      singleStore.markColumnAvailable(root2, 0);
      expect(singleStore.hasColumn(root1, 0)).toBe(false);
      expect(singleStore.hasColumn(root2, 0)).toBe(true);
    });
  });

  describe("TTL-based expiration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should remove expired blocks during eviction", () => {
      // Note: eviction is only triggered when blocks.size >= maxBlocks.
      // To test TTL expiration, we need the store to be at capacity when adding a new block.
      const shortTTLStore = new InMemoryColumnAvailabilityStore({
        maxBlocks: 2,
        blockTTL: 1000, // 1 second TTL
      });

      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);
      const root3 = createBlockRoot(3);

      // Add two blocks to reach capacity
      shortTTLStore.markColumnAvailable(root1, 0);
      shortTTLStore.markColumnAvailable(root2, 0);

      // Advance time past TTL for root1 and root2
      vi.advanceTimersByTime(2000);

      // Add a third block - this triggers eviction check
      // Both root1 and root2 are expired, so they should be removed
      shortTTLStore.markColumnAvailable(root3, 0);

      // root1 and root2 should be expired and removed
      expect(shortTTLStore.hasColumn(root1, 0)).toBe(false);
      expect(shortTTLStore.hasColumn(root2, 0)).toBe(false);
      expect(shortTTLStore.hasColumn(root3, 0)).toBe(true);
    });

    it("should not expire blocks that were recently updated", () => {
      const shortTTLStore = new InMemoryColumnAvailabilityStore({
        maxBlocks: 10,
        blockTTL: 5000, // 5 second TTL
      });

      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);

      shortTTLStore.markColumnAvailable(root1, 0);

      // Advance time but not past TTL
      vi.advanceTimersByTime(3000);

      // Update root1 - this should refresh its lastUpdated
      shortTTLStore.markColumnAvailable(root1, 1);

      // Advance time again - total 6 seconds from original, but only 3 from last update
      vi.advanceTimersByTime(3000);

      // Add another block to trigger eviction check
      shortTTLStore.markColumnAvailable(root2, 0);

      // root1 should still be there since it was updated recently
      expect(shortTTLStore.hasColumn(root1, 0)).toBe(true);
      expect(shortTTLStore.hasColumn(root1, 1)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle all NUMBER_OF_COLUMNS columns for a single block", () => {
      for (let i = 0; i < NUMBER_OF_COLUMNS; i++) {
        store.markColumnAvailable(blockRoot, i);
      }

      for (let i = 0; i < NUMBER_OF_COLUMNS; i++) {
        expect(store.hasColumn(blockRoot, i)).toBe(true);
      }

      expect(store.getColumnCount(blockRoot)).toBe(NUMBER_OF_COLUMNS);
    });

    it("should work with default options", () => {
      const defaultStore = new InMemoryColumnAvailabilityStore();
      defaultStore.markColumnAvailable(blockRoot, 0);
      expect(defaultStore.hasColumn(blockRoot, 0)).toBe(true);
    });

    it("should handle multiple different block roots", () => {
      const roots = Array.from({length: 10}, (_, i) => createBlockRoot(i));

      roots.forEach((root, i) => {
        store.markColumnAvailable(root, i);
      });

      roots.forEach((root, i) => {
        expect(store.hasColumn(root, i)).toBe(true);
        expect(store.hasColumn(root, i + 1)).toBe(false);
        expect(store.getColumnCount(root)).toBe(1);
      });
    });

    it("should return correct metadata size", () => {
      store.markColumnAvailable(blockRoot, 0);
      const columns = store.getAvailableColumns(blockRoot);
      const expectedSize = Math.ceil(NUMBER_OF_COLUMNS / 8);
      expect(columns).not.toBeNull();
      expect(columns!.length).toBe(expectedSize);
    });
  });
});
