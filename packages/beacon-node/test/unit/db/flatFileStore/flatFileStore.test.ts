import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {FlatFileStore} from "../../../../src/db/flatFileStore/flatFileStore.js";

// Minimal logger for tests
const testLogger = {
  info: () => {},
  debug: () => {},
  verbose: () => {},
  warn: () => {},
  error: () => {},
} as any;

// Valid 32-byte hex roots for testing
const ROOT_A = "0x" + "aa".repeat(32);
const ROOT_B = "0x" + "bb".repeat(32);
const ROOT_C = "0x" + "cc".repeat(32);
const ROOT_ORPHAN = "0x" + "11".repeat(32);
const ROOT_CANONICAL = "0x" + "22".repeat(32);

describe("FlatFileStore", () => {
  let tmpDir: string;
  let store: FlatFileStore;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lodestar-flatfile-"));
    store = new FlatFileStore(tmpDir, testLogger);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
  });

  describe("blobs", () => {
    it("should put and get blob sidecars binary", async () => {
      const data = new Uint8Array(100).fill(0xab);
      await store.putBlobSidecars(1000, ROOT_A, data);

      const result = await store.getBlobSidecarsBinary(1000, ROOT_A);
      expect(new Uint8Array(result!)).toEqual(data);
    });

    it("should return null for missing blobs", async () => {
      const result = await store.getBlobSidecarsBinary(999, ROOT_A);
      expect(result).toBeNull();
    });

    it("should check existence via cache (sync)", async () => {
      expect(store.hasBlobSidecars(1000, ROOT_A)).toBe(false);

      await store.putBlobSidecars(1000, ROOT_A, new Uint8Array(10));
      expect(store.hasBlobSidecars(1000, ROOT_A)).toBe(true);
    });

    it("should delete blob sidecars", async () => {
      await store.putBlobSidecars(1000, ROOT_A, new Uint8Array(10));
      await store.deleteBlobSidecars(1000, ROOT_A);

      expect(store.hasBlobSidecars(1000, ROOT_A)).toBe(false);
      expect(await store.getBlobSidecarsBinary(1000, ROOT_A)).toBeNull();
    });

    it("should stream binary entries in slot range", async () => {
      await store.putBlobSidecars(100, ROOT_A, new Uint8Array([1]));
      await store.putBlobSidecars(200, ROOT_B, new Uint8Array([2]));
      await store.putBlobSidecars(300, ROOT_C, new Uint8Array([3]));

      const entries: {slot: number; data: Uint8Array}[] = [];
      for await (const entry of store.blobSidecarsBinaryEntriesStream({gte: 100, lt: 300})) {
        entries.push(entry);
      }

      expect(entries.length).toBe(2);
      expect(entries[0].slot).toBe(100);
      expect(entries[1].slot).toBe(200);
    });

    it("should prune blobs before slot", async () => {
      await store.putBlobSidecars(100, ROOT_A, new Uint8Array([1]));
      await store.putBlobSidecars(200, ROOT_B, new Uint8Array([2]));
      await store.putBlobSidecars(300, ROOT_C, new Uint8Array([3]));

      await store.pruneBlobsBeforeSlot(200);

      expect(await store.getBlobSidecarsBinary(100, ROOT_A)).toBeNull();
      expect(await store.getBlobSidecarsBinary(200, ROOT_B)).not.toBeNull();
      expect(await store.getBlobSidecarsBinary(300, ROOT_C)).not.toBeNull();
    });
  });

  describe("columns", () => {
    it("should put and get binary columns", async () => {
      const col0 = new Uint8Array(50).fill(0x01);
      const col5 = new Uint8Array(50).fill(0x05);

      await store.putDataColumnsBinary(1000, ROOT_A, [
        {index: 0, data: col0},
        {index: 5, data: col5},
      ]);

      const result = await store.getDataColumnsBinary(1000, ROOT_A, [0, 5, 10]);
      expect(new Uint8Array(result[0]!)).toEqual(col0);
      expect(new Uint8Array(result[1]!)).toEqual(col5);
      expect(result[2]).toBeUndefined();
    });

    it("should check column existence via cache (sync)", async () => {
      expect(store.hasDataColumn(1000, ROOT_A, 0)).toBe(false);

      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: new Uint8Array(30)}]);
      expect(store.hasDataColumn(1000, ROOT_A, 0)).toBe(true);
      expect(store.hasDataColumn(1000, ROOT_A, 1)).toBe(false);
    });

    it("should return bitmap", async () => {
      await store.putDataColumnsBinary(1000, ROOT_A, [
        {index: 0, data: new Uint8Array(20)},
        {index: 3, data: new Uint8Array(20)},
      ]);

      const bitmap = store.getColumnBitmap(1000, ROOT_A);
      expect(bitmap).toBe(0b1001n); // bits 0 and 3
    });

    it("should merge columns incrementally", async () => {
      const col0 = new Uint8Array(40).fill(0x01);
      const col1 = new Uint8Array(40).fill(0x02);
      const col2 = new Uint8Array(40).fill(0x03);

      // First write
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: col0}]);

      // Second write (should merge)
      await store.putDataColumnsBinary(1000, ROOT_A, [
        {index: 1, data: col1},
        {index: 2, data: col2},
      ]);

      // All three columns should be present
      const result = await store.getDataColumnsBinary(1000, ROOT_A, [0, 1, 2]);
      expect(new Uint8Array(result[0]!)).toEqual(col0);
      expect(new Uint8Array(result[1]!)).toEqual(col1);
      expect(new Uint8Array(result[2]!)).toEqual(col2);
    });

    it("should delete columns", async () => {
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: new Uint8Array(20)}]);
      await store.deleteDataColumns(1000, ROOT_A);

      expect(store.hasDataColumn(1000, ROOT_A, 0)).toBe(false);
      const result = await store.getDataColumnsBinary(1000, ROOT_A, [0]);
      expect(result[0]).toBeUndefined();
    });

    it("should get columns by slot (canonical lookup)", async () => {
      const col0 = new Uint8Array(25).fill(0xaa);
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: col0}]);

      const result = await store.getDataColumnsBinaryBySlot(1000, [0, 1]);
      expect(new Uint8Array(result[0]!)).toEqual(col0);
      expect(result[1]).toBeUndefined();
    });

    it("should prune columns before slot", async () => {
      await store.putDataColumnsBinary(100, ROOT_A, [{index: 0, data: new Uint8Array(20)}]);
      await store.putDataColumnsBinary(200, ROOT_B, [{index: 0, data: new Uint8Array(20)}]);

      await store.pruneColumnsBeforeSlot(200);

      expect(store.hasDataColumn(100, ROOT_A, 0)).toBe(false);
      expect(store.hasDataColumn(200, ROOT_B, 0)).toBe(true);
    });
  });

  describe("deleteNonCanonical", () => {
    it("should delete blobs and columns for non-canonical blocks", async () => {
      await store.putBlobSidecars(100, ROOT_ORPHAN, new Uint8Array(10));
      await store.putDataColumnsBinary(100, ROOT_ORPHAN, [{index: 0, data: new Uint8Array(20)}]);
      await store.putBlobSidecars(100, ROOT_CANONICAL, new Uint8Array(10));

      await store.deleteNonCanonical([{slot: 100, blockRoot: ROOT_ORPHAN}]);

      expect(store.hasBlobSidecars(100, ROOT_ORPHAN)).toBe(false);
      expect(store.hasDataColumn(100, ROOT_ORPHAN, 0)).toBe(false);
      // Canonical should remain
      expect(store.hasBlobSidecars(100, ROOT_CANONICAL)).toBe(true);
    });
  });

  describe("cache rebuild", () => {
    it("should rebuild cache from disk after restart", async () => {
      // Write some data
      await store.putBlobSidecars(1000, ROOT_A, new Uint8Array(10));
      await store.putDataColumnsBinary(1000, ROOT_B, [
        {index: 0, data: new Uint8Array(20)},
        {index: 5, data: new Uint8Array(20)},
      ]);

      // Create a new store (simulating restart)
      const store2 = new FlatFileStore(tmpDir, testLogger);
      await store2.init();

      // Cache should be rebuilt
      expect(store2.hasBlobSidecars(1000, ROOT_A)).toBe(true);
      expect(store2.hasDataColumn(1000, ROOT_B, 0)).toBe(true);
      expect(store2.hasDataColumn(1000, ROOT_B, 5)).toBe(true);
      expect(store2.hasDataColumn(1000, ROOT_B, 1)).toBe(false);
    });
  });
});
