import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {LogLevel, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {fulu, gloas, ssz} from "@lodestar/types";
import {DCOL_VERSION} from "../../../../src/db/flatFileStore/dcolFormat.js";
import {FlatFileStore} from "../../../../src/db/flatFileStore/flatFileStore.js";

// Valid 32-byte hex roots for testing
const ROOT_A = "0x" + "aa".repeat(32);
const ROOT_B = "0x" + "bb".repeat(32);
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
    store = new FlatFileStore(tmpDir, config, testLogger());
    await store.init(Number.MAX_SAFE_INTEGER);
  });

  afterEach(async () => {
    await store.close();
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
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
      expect(new Uint8Array(result[0] ?? [])).toEqual(col0);
      expect(new Uint8Array(result[1] ?? [])).toEqual(col5);
      expect(result[2]).toBeUndefined();
    });

    it("should derive the column SSZ type from the slot", async () => {
      const fuluColumn = ssz.fulu.DataColumnSidecar.defaultValue();
      const gloasColumn = ssz.gloas.DataColumnSidecar.defaultValue();
      const gloasSlot = SLOTS_PER_EPOCH;

      await store.putDataColumnsBinary(0, ROOT_A, [
        {index: fuluColumn.index, data: ssz.fulu.DataColumnSidecar.serialize(fuluColumn)},
      ]);
      await store.putDataColumnsBinary(gloasSlot, ROOT_B, [
        {index: gloasColumn.index, data: ssz.gloas.DataColumnSidecar.serialize(gloasColumn)},
      ]);

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
      expect(new Uint8Array(result[0] ?? [])).toEqual(col0);
      expect(new Uint8Array(result[1] ?? [])).toEqual(col1);
      expect(new Uint8Array(result[2] ?? [])).toEqual(col2);
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

    it("should preserve column data when deletion fails", async () => {
      const column = new Uint8Array(20);
      await store.putDataColumnsBinary(1000, ROOT_A, [{index: 0, data: column}]);
      const deleteError = new Error("delete failed");
      const originalRm = fs.promises.rm.bind(fs.promises);
      const rmSpy = vi.spyOn(fs.promises, "rm").mockImplementation(async (filePath, options) => {
        if (String(filePath).includes("data_columns")) {
          throw deleteError;
        }
        return originalRm(filePath, options);
      });

      try {
        await expect(store.deleteNonCanonical([{slot: 1000, blockRoot: ROOT_A}])).rejects.toMatchObject({
          errors: [deleteError],
        });
      } finally {
        rmSpy.mockRestore();
      }

      expect(await store.getDataColumnsBinary(1000, ROOT_A, [0])).toEqual([column]);
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
      await store.deleteNonCanonical([{slot: 100, blockRoot: ROOT_A}]);

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
      if (!dcolFile) throw new Error("Expected a dcol file");

      const raw = await fs.promises.readFile(path.join(slotDir, dcolFile));
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

    it("should reject traversal-shaped roots before deleting files", async () => {
      const columnSiblingPath = path.join(tmpDir, "data_columns", "escape.dcol");
      const sentinel = new Uint8Array([1, 2, 3]);
      await fs.promises.writeFile(columnSiblingPath, sentinel);

      const error = await store.deleteNonCanonical([{slot: 100, blockRoot: "../escape"}]).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AggregateError);
      const causes = (error as AggregateError).errors;
      expect(causes).toHaveLength(1);
      expect(causes[0]).toMatchObject({message: expect.stringContaining("Invalid flat file root")});

      expect(new Uint8Array(await fs.promises.readFile(columnSiblingPath))).toEqual(sentinel);
    });
  });

  describe("deleteNonCanonical", () => {
    it("should delete columns only for non-canonical blocks", async () => {
      await store.putDataColumnsBinary(100, ROOT_ORPHAN, [{index: 0, data: new Uint8Array(20)}]);
      await store.putDataColumnsBinary(100, ROOT_CANONICAL, [{index: 0, data: new Uint8Array(20)}]);

      await store.deleteNonCanonical([{slot: 100, blockRoot: ROOT_ORPHAN}]);

      expect(await store.getDataColumnsBinary(100, ROOT_ORPHAN, [0])).toEqual([undefined]);
      expect(await store.getDataColumnsBinary(100, ROOT_CANONICAL, [0])).not.toEqual([undefined]);
    });
  });

  describe("cache rebuild", () => {
    it("should rebuild cache from disk after restart", async () => {
      await store.putDataColumnsBinary(1000, ROOT_B, [
        {index: 0, data: new Uint8Array(20)},
        {index: 5, data: new Uint8Array(20)},
      ]);

      const store2 = new FlatFileStore(tmpDir, config, testLogger());
      const openSpy = vi.spyOn(fs.promises, "open");
      try {
        await store2.init(Number.MAX_SAFE_INTEGER);
        expect(openSpy).not.toHaveBeenCalled();
      } finally {
        openSpy.mockRestore();
      }

      const columns = await store2.getDataColumnsBinary(1000, ROOT_B, [0, 5, 1]);
      expect(columns[0]).toBeDefined();
      expect(columns[1]).toBeDefined();
      expect(columns[2]).toBeUndefined();
    });

    it("should ignore partial files and retain their slot directories for pruning", async () => {
      const columnSlotDir = path.join(tmpDir, "data_columns", "000000000100");
      await fs.promises.mkdir(columnSlotDir, {recursive: true});
      const columnPartPath = path.join(columnSlotDir, `${ROOT_A}.dcol.part-crash`);
      await fs.promises.writeFile(columnPartPath, new Uint8Array([2]));

      const store2 = new FlatFileStore(tmpDir, config, testLogger());
      await store2.init(Number.MAX_SAFE_INTEGER);
      expect(await store2.getDataColumnsBinary(100, ROOT_A, [0])).toEqual([undefined]);
      await expect(fs.promises.access(columnPartPath)).resolves.toBeUndefined();

      await store2.pruneColumnsBeforeSlot(200);

      await expect(fs.promises.access(columnSlotDir)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("should only cache canonical slot directories and root filenames", async () => {
      const validData = new Uint8Array([1, 2, 3]);
      await store.putDataColumnsBinary(100, ROOT_A, [{index: 0, data: validData}]);

      const columnSlotDir = path.join(tmpDir, "data_columns", "000000000103");
      const malformedColumnPath = path.join(columnSlotDir, "0xabc.dcol");
      await fs.promises.mkdir(columnSlotDir, {recursive: true});
      await fs.promises.writeFile(malformedColumnPath, new Uint8Array([6]));

      const nonCanonicalColumnDir = path.join(tmpDir, "data_columns", "102");
      const nonCanonicalColumnPath = path.join(nonCanonicalColumnDir, `${ROOT_B}.dcol`);
      await fs.promises.mkdir(nonCanonicalColumnDir, {recursive: true});
      await fs.promises.writeFile(nonCanonicalColumnPath, new Uint8Array([5]));

      const logger = testLogger();
      const warn = vi.spyOn(logger, LogLevel.warn);
      const store2 = new FlatFileStore(tmpDir, config, logger);
      await store2.init(Number.MAX_SAFE_INTEGER);

      const readdirSpy = vi.spyOn(fs.promises, "readdir");
      try {
        expect(await store2.getDataColumnsBinary(100, ROOT_A, [0])).toEqual([validData]);
        expect(readdirSpy).not.toHaveBeenCalled();
      } finally {
        readdirSpy.mockRestore();
      }
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith("Ignored non-canonical flat file store entries", {
        columnEntries: 2,
      });

      await expect(fs.promises.access(malformedColumnPath)).resolves.toBeUndefined();
      await expect(fs.promises.access(nonCanonicalColumnPath)).resolves.toBeUndefined();
    });

    it("should not scan storage directories while pruning", async () => {
      await store.putDataColumnsBinary(100, ROOT_A, [{index: 0, data: new Uint8Array(20)}]);
      const readdirSpy = vi.spyOn(fs.promises, "readdir");

      try {
        await store.pruneColumnsBeforeSlot(200);
        expect(readdirSpy).not.toHaveBeenCalled();
      } finally {
        readdirSpy.mockRestore();
      }
    });

    it("should remove hot data after restart", async () => {
      const finalizedBlockSlot = 100;
      const skippedBoundarySlot = finalizedBlockSlot + 1;
      const hotSlot = finalizedBlockSlot + 2;

      await store.putDataColumnsBinary(finalizedBlockSlot, ROOT_A, [{index: 0, data: new Uint8Array([2])}]);
      await store.putDataColumnsBinary(skippedBoundarySlot, ROOT_B, [{index: 0, data: new Uint8Array([3])}]);
      await store.putDataColumnsBinary(hotSlot, ROOT_B, [{index: 0, data: new Uint8Array([4])}]);

      const store2 = new FlatFileStore(tmpDir, config, testLogger());
      await store2.init(finalizedBlockSlot);

      expect(await store2.getDataColumnsBinary(finalizedBlockSlot, ROOT_A, [0])).toEqual([new Uint8Array([2])]);
      expect(await store2.getDataColumnsBinary(skippedBoundarySlot, ROOT_B, [0])).toEqual([undefined]);
      expect(await store2.getDataColumnsBinary(hotSlot, ROOT_B, [0])).toEqual([undefined]);
      for (const slot of [skippedBoundarySlot, hotSlot]) {
        await expect(
          fs.promises.access(path.join(tmpDir, "data_columns", String(slot).padStart(12, "0")))
        ).rejects.toMatchObject({code: "ENOENT"});
      }
    });
  });
});
