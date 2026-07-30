import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {fulu, gloas, ssz} from "@lodestar/types";
import {DCOL_VERSION} from "../../../../src/db/flatFileStore/dcolFormat.js";
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
  const config = createChainForkConfig({
    ...defaultConfig,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 1,
  });

  let tmpDir: string;
  let store: FlatFileStore;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lodestar-flatfile-"));
    store = new FlatFileStore(tmpDir, config, testLogger);
    await store.init(Number.MAX_SAFE_INTEGER);
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

    it("should propagate blob read errors", async () => {
      const readError = Object.assign(new Error("read failed"), {code: "EIO"});
      const readSpy = vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(readError);

      try {
        await expect(store.getBlobSidecarsBinary(1000, ROOT_A)).rejects.toBe(readError);
      } finally {
        readSpy.mockRestore();
      }
    });

    it("should not choose an arbitrary blob root for a slot", async () => {
      await store.putBlobSidecars(1000, ROOT_A, new Uint8Array([1]));
      await store.putBlobSidecars(1000, ROOT_B, new Uint8Array([2]));

      expect(await store.getBlobSidecarsBinaryBySlot(1000)).toBeNull();
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

    it("should preserve blob cache entries when deletion fails", async () => {
      await store.putBlobSidecars(1000, ROOT_A, new Uint8Array(10));
      const deleteError = new Error("delete failed");
      const rmSpy = vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(deleteError);

      try {
        await expect(store.deleteBlobSidecars(1000, ROOT_A)).rejects.toBe(deleteError);
        expect(store.hasBlobSidecars(1000, ROOT_A)).toBe(true);
      } finally {
        rmSpy.mockRestore();
      }
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

    it("should prune empty blob slot directories retained in the cache", async () => {
      const slotDir = path.join(tmpDir, "blob_sidecars", "000000000100");
      await store.putBlobSidecars(100, ROOT_A, new Uint8Array([1]));
      await store.deleteBlobSidecars(100, ROOT_A);

      await store.pruneBlobsBeforeSlot(200);

      await expect(fs.promises.access(slotDir)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("should retain a blob slot in the cache when pruning fails", async () => {
      await store.putBlobSidecars(100, ROOT_A, new Uint8Array([1]));
      const pruneError = new Error("prune failed");
      const rmSpy = vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(pruneError);

      try {
        await expect(store.pruneBlobsBeforeSlot(200)).rejects.toBe(pruneError);
        expect(store.hasBlobSidecars(100, ROOT_A)).toBe(true);
      } finally {
        rmSpy.mockRestore();
      }
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

    it("should derive the column SSZ type from the slot", async () => {
      const fuluColumn = ssz.fulu.DataColumnSidecar.defaultValue();
      const gloasColumn = ssz.gloas.DataColumnSidecar.defaultValue();
      const gloasSlot = SLOTS_PER_EPOCH;

      await store.putDataColumns(0, ROOT_A, [fuluColumn]);
      await store.putDataColumns(gloasSlot, ROOT_B, [gloasColumn]);

      const [storedFuluColumn] = await store.getDataColumns(0, ROOT_A);
      const [storedGloasColumn] = await store.getDataColumns(gloasSlot, ROOT_B);
      expect(ssz.fulu.DataColumnSidecar.serialize(storedFuluColumn as fulu.DataColumnSidecar)).toEqual(
        ssz.fulu.DataColumnSidecar.serialize(fuluColumn)
      );
      expect(ssz.gloas.DataColumnSidecar.serialize(storedGloasColumn as gloas.DataColumnSidecar)).toEqual(
        ssz.gloas.DataColumnSidecar.serialize(gloasColumn)
      );
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

    it("should not overwrite existing columns when the merge read fails", async () => {
      const col0 = new Uint8Array(40).fill(0x01);
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: col0}]);

      const readError = Object.assign(new Error("read failed"), {code: "EIO"});
      const readSpy = vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(readError);
      try {
        await expect(
          store.putDataColumnsBinary(1000, ROOT_A, [{index: 1, data: new Uint8Array(40).fill(0x02)}])
        ).rejects.toBe(readError);
      } finally {
        readSpy.mockRestore();
      }

      const [storedCol0, storedCol1] = await store.getDataColumnsBinary(1000, ROOT_A, [0, 1]);
      expect(storedCol0).toEqual(col0);
      expect(storedCol1).toBeUndefined();
    });

    it("should delete columns", async () => {
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: new Uint8Array(20)}]);
      await store.deleteDataColumns(1000, ROOT_A);

      const result = await store.getDataColumnsBinary(1000, ROOT_A, [0]);
      expect(result[0]).toBeUndefined();
    });

    it("should preserve column data when deletion fails", async () => {
      const column = new Uint8Array(20);
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: column}]);
      const deleteError = new Error("delete failed");
      const rmSpy = vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(deleteError);

      try {
        await expect(store.deleteDataColumns(1000, ROOT_A)).rejects.toBe(deleteError);
      } finally {
        rmSpy.mockRestore();
      }

      expect(await store.getDataColumnsBinary(1000, ROOT_A, [0])).toEqual([column]);
    });

    it("should get columns by slot (canonical lookup)", async () => {
      const col0 = new Uint8Array(25).fill(0xaa);
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: col0}]);

      const result = await store.getDataColumnsBinaryBySlot(1000, [0, 1]);
      expect(new Uint8Array(result[0]!)).toEqual(col0);
      expect(result[1]).toBeUndefined();
    });

    it("should not choose an arbitrary column root for a slot", async () => {
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: new Uint8Array([1])}]);
      await store.putDataColumnsBinary(1000, ROOT_B, [{index: 0, data: new Uint8Array([2])}]);

      expect(await store.getDataColumnsBinaryBySlot(1000, [0])).toEqual([undefined]);
    });

    it("should resolve column roots independently from blob roots", async () => {
      const column = new Uint8Array([2]);
      await store.putBlobSidecars(1000, ROOT_A, new Uint8Array([1]));
      await store.putDataColumnsBinary(1000, ROOT_B, [{index: 0, data: column}]);

      const [result] = await store.getDataColumnsBinaryBySlot(1000, [0]);
      expect(result).toEqual(column);
    });

    it("should prune columns before slot", async () => {
      await store.putDataColumnsBinary(100, ROOT_A, [{index: 0, data: new Uint8Array(20)}]);
      await store.putDataColumnsBinary(200, ROOT_B, [{index: 0, data: new Uint8Array(20)}]);

      await store.pruneColumnsBeforeSlot(200);

      expect(await store.getDataColumnsBinary(100, ROOT_A, [0])).toEqual([undefined]);
      expect(await store.getDataColumnsBinary(200, ROOT_B, [0])).not.toEqual([undefined]);
    });

    it("should prune empty column slot directories retained in the cache", async () => {
      const slotDir = path.join(tmpDir, "data_columns", "000000000100");
      await store.putDataColumnsBinary(100, ROOT_A, [{index: 0, data: new Uint8Array(20)}]);
      await store.deleteDataColumns(100, ROOT_A);

      await store.pruneColumnsBeforeSlot(200);

      await expect(fs.promises.access(slotDir)).rejects.toMatchObject({code: "ENOENT"});
    });
  });

  describe("on-disk format", () => {
    it("should write dcol files with correct version byte", async () => {
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: new Uint8Array(50).fill(0x42)}]);

      // Read the raw file and check version byte
      const slotDir = path.join(tmpDir, "data_columns", "000000001000");
      const files = await fs.promises.readdir(slotDir);
      const dcolFile = files.find((f) => f.endsWith(".dcol"));
      expect(dcolFile).toBeDefined();

      const raw = await fs.promises.readFile(path.join(slotDir, dcolFile!));
      expect(raw[0]).toBe(DCOL_VERSION);
    });

    it("should reject truncated dcol files when read", async () => {
      const slotDir = path.join(tmpDir, "data_columns", "000000001000");
      await fs.promises.mkdir(slotDir, {recursive: true});
      await fs.promises.writeFile(path.join(slotDir, `${ROOT_A}.dcol`), new Uint8Array([DCOL_VERSION]));

      await expect(store.getDataColumnsBinary(1000, ROOT_A, [0])).rejects.toThrow("Unexpected end of dcol file");
    });

    it("should reject a dcol file whose header root does not match its path", async () => {
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: new Uint8Array(20)}]);
      const slotDir = path.join(tmpDir, "data_columns", "000000001000");
      await fs.promises.rename(path.join(slotDir, `${ROOT_A}.dcol`), path.join(slotDir, `${ROOT_B}.dcol`));

      await expect(store.getDataColumnsBinary(1000, ROOT_B, [0])).rejects.toThrow("Dcol block root mismatch");
    });
  });

  describe("deleteNonCanonical", () => {
    it("should delete blobs and columns for non-canonical blocks", async () => {
      await store.putBlobSidecars(100, ROOT_ORPHAN, new Uint8Array(10));
      await store.putDataColumnsBinary(100, ROOT_ORPHAN, [{index: 0, data: new Uint8Array(20)}]);
      await store.putBlobSidecars(100, ROOT_CANONICAL, new Uint8Array(10));

      await store.deleteNonCanonical([{slot: 100, blockRoot: ROOT_ORPHAN}]);

      expect(store.hasBlobSidecars(100, ROOT_ORPHAN)).toBe(false);
      expect(await store.getDataColumnsBinary(100, ROOT_ORPHAN, [0])).toEqual([undefined]);
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
      const store2 = new FlatFileStore(tmpDir, config, testLogger);
      const openSpy = vi.spyOn(fs.promises, "open");
      try {
        await store2.init(Number.MAX_SAFE_INTEGER);
        expect(openSpy).not.toHaveBeenCalled();
      } finally {
        openSpy.mockRestore();
      }

      expect(store2.hasBlobSidecars(1000, ROOT_A)).toBe(true);
      const columns = await store2.getDataColumnsBinaryBySlot(1000, [0, 5, 1]);
      expect(columns[0]).toBeDefined();
      expect(columns[1]).toBeDefined();
      expect(columns[2]).toBeUndefined();
    });

    it("should rebuild empty slot entries for cache-driven pruning", async () => {
      const blobSlotDir = path.join(tmpDir, "blob_sidecars", "000000000100");
      const columnSlotDir = path.join(tmpDir, "data_columns", "000000000100");
      await fs.promises.mkdir(blobSlotDir, {recursive: true});
      await fs.promises.mkdir(columnSlotDir, {recursive: true});

      const store2 = new FlatFileStore(tmpDir, config, testLogger);
      await store2.init(Number.MAX_SAFE_INTEGER);
      await store2.pruneBlobsBeforeSlot(200);
      await store2.pruneColumnsBeforeSlot(200);

      await expect(fs.promises.access(blobSlotDir)).rejects.toMatchObject({code: "ENOENT"});
      await expect(fs.promises.access(columnSlotDir)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("should not scan storage directories while pruning", async () => {
      await store.putBlobSidecars(100, ROOT_A, new Uint8Array([1]));
      await store.putDataColumnsBinary(100, ROOT_A, [{index: 0, data: new Uint8Array(20)}]);
      const readdirSpy = vi.spyOn(fs.promises, "readdir");

      try {
        await store.pruneBlobsBeforeSlot(200);
        await store.pruneColumnsBeforeSlot(200);
        expect(readdirSpy).not.toHaveBeenCalled();
      } finally {
        readdirSpy.mockRestore();
      }
    });

    it("should remove hot data after restart", async () => {
      const finalizedCheckpointSlot = 100;
      const hotSlot = finalizedCheckpointSlot + 1;

      await store.putBlobSidecars(finalizedCheckpointSlot, ROOT_A, new Uint8Array([1]));
      await store.putDataColumnsBinary(finalizedCheckpointSlot, ROOT_A, [{index: 0, data: new Uint8Array([2])}]);
      await store.putBlobSidecars(hotSlot, ROOT_B, new Uint8Array([3]));
      await store.putDataColumnsBinary(hotSlot, ROOT_B, [{index: 0, data: new Uint8Array([4])}]);

      const store2 = new FlatFileStore(tmpDir, config, testLogger);
      await store2.init(finalizedCheckpointSlot);

      expect(store2.hasBlobSidecars(finalizedCheckpointSlot, ROOT_A)).toBe(true);
      expect(await store2.getDataColumnsBinary(finalizedCheckpointSlot, ROOT_A, [0])).toEqual([new Uint8Array([2])]);
      expect(store2.hasBlobSidecars(hotSlot, ROOT_B)).toBe(false);
      expect(await store2.getDataColumnsBinary(hotSlot, ROOT_B, [0])).toEqual([undefined]);
      await expect(fs.promises.access(path.join(tmpDir, "blobs", "000000000101"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fs.promises.access(path.join(tmpDir, "data_columns", "000000000101"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});
