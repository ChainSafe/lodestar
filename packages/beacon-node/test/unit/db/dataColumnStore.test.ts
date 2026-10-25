import {describe, expect, it, vi} from "vitest";
import {type RootHex, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {LegacyDataColumnStore} from "../../../src/db/dataColumnStore.js";
import type {IFlatFileStore} from "../../../src/db/flatFileStore/interface.js";

const ROOT: RootHex = `0x${"ab".repeat(32)}`;

describe("LegacyDataColumnStore", () => {
  it("should read missing flat files from hot and canonical archive storage", async () => {
    const hotData = new Uint8Array([2]);
    const archiveData = new Uint8Array([3]);
    const flatFiles = makeFlatFiles();
    const getHot = vi.fn(async (_root: Uint8Array, indices: number[]) =>
      indices.map((index) => (index === 1 ? hotData : undefined))
    );
    const getArchived = vi.fn(async (_slot: number, indices: number[]) =>
      indices.map((index) => (index === 2 ? archiveData : undefined))
    );
    const store = new LegacyDataColumnStore(
      flatFiles,
      {values: vi.fn().mockResolvedValue([]), getManyBinary: getHot, deleteMany: vi.fn()},
      {
        values: vi.fn().mockResolvedValue([]),
        getManyBinary: getArchived,
        keys: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      {getSlotByRoot: vi.fn().mockResolvedValue(10)}
    );

    await expect(store.getManyBinary({slot: 10, blockRoot: ROOT}, [0, 1, 2])).resolves.toEqual([
      undefined,
      hotData,
      archiveData,
    ]);
    expect(getHot).toHaveBeenCalledWith(fromHex(ROOT), [0, 1, 2]);
    expect(getArchived).toHaveBeenCalledWith(10, [0, 2]);
  });

  it.each([{columns: [new Uint8Array([1]), undefined]}, {columns: [undefined, undefined]}])(
    "should not read legacy storage for an existing flat file: $columns",
    async ({columns}) => {
      const flatFiles = makeFlatFiles();
      vi.mocked(flatFiles.getDataColumnsBinary).mockResolvedValue([...columns]);
      const getHot = vi.fn().mockResolvedValue([new Uint8Array([2]), new Uint8Array([3])]);
      const getArchived = vi.fn().mockResolvedValue([new Uint8Array([4]), new Uint8Array([5])]);
      const getSlotByRoot = vi.fn().mockResolvedValue(10);
      const store = new LegacyDataColumnStore(
        flatFiles,
        {values: vi.fn(), getManyBinary: getHot, deleteMany: vi.fn()},
        {values: vi.fn(), getManyBinary: getArchived, keys: vi.fn(), deleteMany: vi.fn()},
        {getSlotByRoot}
      );

      await expect(store.getManyBinary({slot: 10, blockRoot: ROOT}, [0, 1])).resolves.toEqual(columns);
      expect(getHot).not.toHaveBeenCalled();
      expect(getArchived).not.toHaveBeenCalled();
      expect(getSlotByRoot).not.toHaveBeenCalled();
    }
  );

  it("should skip legacy reads when no column indices are requested", async () => {
    const getHot = vi.fn();
    const store = new LegacyDataColumnStore(
      makeFlatFiles(),
      {values: vi.fn(), getManyBinary: getHot, deleteMany: vi.fn()},
      {values: vi.fn(), getManyBinary: vi.fn(), keys: vi.fn(), deleteMany: vi.fn()},
      {getSlotByRoot: vi.fn()}
    );

    await expect(store.getManyBinary({slot: 10, blockRoot: ROOT}, [])).resolves.toEqual([]);
    expect(getHot).not.toHaveBeenCalled();
  });

  it("should not read a slot-keyed archive for a non-canonical root", async () => {
    const flatFiles = makeFlatFiles();
    const getArchived = vi.fn().mockResolvedValue([new Uint8Array([3])]);
    const store = new LegacyDataColumnStore(
      flatFiles,
      {
        values: vi.fn().mockResolvedValue([]),
        getManyBinary: vi.fn().mockResolvedValue([undefined]),
        deleteMany: vi.fn(),
      },
      {
        values: vi.fn().mockResolvedValue([]),
        getManyBinary: getArchived,
        keys: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      {getSlotByRoot: vi.fn().mockResolvedValue(null)}
    );

    await expect(store.getManyBinary({slot: 10, blockRoot: ROOT}, [0])).resolves.toEqual([undefined]);
    expect(getArchived).not.toHaveBeenCalled();
  });

  it.each(["flat files", "legacy storage"])("should read complete sidecars from %s", async (source) => {
    const flatColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    flatColumn.index = 0;
    const duplicateHotColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    duplicateHotColumn.index = 0;
    const hotColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    hotColumn.index = 1;
    const archivedColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    archivedColumn.index = 2;
    const flatFiles = makeFlatFiles();
    vi.mocked(flatFiles.getDataColumns).mockResolvedValue(source === "flat files" ? [flatColumn] : []);
    const getHot = vi.fn().mockResolvedValue([hotColumn, duplicateHotColumn]);
    const getArchived = vi.fn().mockResolvedValue([hotColumn, archivedColumn]);
    const getSlotByRoot = vi.fn().mockResolvedValue(10);
    const store = new LegacyDataColumnStore(
      flatFiles,
      {
        values: getHot,
        getManyBinary: vi.fn(),
        deleteMany: vi.fn(),
      },
      {
        values: getArchived,
        getManyBinary: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      {getSlotByRoot}
    );

    if (source === "flat files") {
      await expect(store.getAll({slot: 10, blockRoot: ROOT})).resolves.toEqual([flatColumn]);
      expect(getHot).not.toHaveBeenCalled();
      expect(getArchived).not.toHaveBeenCalled();
      expect(getSlotByRoot).not.toHaveBeenCalled();
    } else {
      await expect(store.getAll({slot: 10, blockRoot: ROOT})).resolves.toEqual([
        duplicateHotColumn,
        hotColumn,
        archivedColumn,
      ]);
      expect(getHot).toHaveBeenCalledWith(fromHex(ROOT));
      expect(getArchived).toHaveBeenCalledWith(10);
      expect(getSlotByRoot).toHaveBeenCalledWith(fromHex(ROOT));
    }
  });

  it("should coordinate writes, deletion, and pruning across backends", async () => {
    const flatFiles = makeFlatFiles();
    vi.mocked(flatFiles.pruneBefore).mockResolvedValue([4, 2]);
    const deleteHot = vi.fn().mockResolvedValue(undefined);
    const deleteArchive = vi.fn().mockResolvedValue(undefined);
    const store = new LegacyDataColumnStore(
      flatFiles,
      {values: vi.fn(), getManyBinary: vi.fn(), deleteMany: deleteHot},
      {
        values: vi.fn(),
        getManyBinary: vi.fn(),
        keys: vi.fn().mockResolvedValue([
          {prefix: 3, id: 0},
          {prefix: 3, id: 1},
          {prefix: 4, id: 0},
        ]),
        deleteMany: deleteArchive,
      },
      {getSlotByRoot: vi.fn()}
    );
    const key = {slot: 10, blockRoot: ROOT};
    const columns = [{index: 0, data: new Uint8Array([1])}];

    await store.putManyBinary(key, columns);
    await store.deleteMany([key]);
    await expect(store.pruneBefore(5)).resolves.toEqual([2, 3, 4]);

    expect(flatFiles.putDataColumnsBinary).toHaveBeenCalledWith(10, ROOT, columns);
    expect(flatFiles.deleteMany).toHaveBeenCalledWith([key]);
    expect(deleteHot).toHaveBeenCalledWith([fromHex(ROOT)]);
    expect(flatFiles.pruneBefore).toHaveBeenCalledWith(5);
    expect(deleteArchive).toHaveBeenCalledWith([3, 4]);
  });
});

function makeFlatFiles(): IFlatFileStore {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getDataColumns: vi.fn().mockResolvedValue([]),
    getDataColumnsBinary: vi.fn().mockResolvedValue(null),
    putDataColumnsBinary: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    pruneBefore: vi.fn().mockResolvedValue([]),
  };
}
