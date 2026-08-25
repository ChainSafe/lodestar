import {describe, expect, it, vi} from "vitest";
import {type RootHex, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {DataColumnStore} from "../../../src/db/dataColumnStore.js";
import type {IFlatFileStore} from "../../../src/db/flatFileStore/interface.js";

const ROOT: RootHex = `0x${"ab".repeat(32)}`;

describe("DataColumnStore", () => {
  it("should fill flat file misses from hot and canonical archive storage", async () => {
    const flatData = new Uint8Array([1]);
    const hotData = new Uint8Array([2]);
    const archiveData = new Uint8Array([3]);
    const flatFiles = makeFlatFiles();
    vi.mocked(flatFiles.getDataColumnsBinary).mockResolvedValue([flatData, undefined, undefined]);
    const getHot = vi.fn(async (_root: Uint8Array, indices: number[]) =>
      indices.map((index) => (index === 1 ? hotData : undefined))
    );
    const getArchived = vi.fn(async (_slot: number, indices: number[]) =>
      indices.map((index) => (index === 2 ? archiveData : undefined))
    );
    const store = new DataColumnStore(
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
      flatData,
      hotData,
      archiveData,
    ]);
    expect(getHot).toHaveBeenCalledWith(fromHex(ROOT), [1, 2]);
    expect(getArchived).toHaveBeenCalledWith(10, [2]);
  });

  it("should not read a slot-keyed archive for a non-canonical root", async () => {
    const flatFiles = makeFlatFiles();
    vi.mocked(flatFiles.getDataColumnsBinary).mockResolvedValue([undefined]);
    const getArchived = vi.fn().mockResolvedValue([new Uint8Array([3])]);
    const store = new DataColumnStore(
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

  it("should merge complete sidecars by backend priority", async () => {
    const flatColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    flatColumn.index = 0;
    const duplicateHotColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    duplicateHotColumn.index = 0;
    const hotColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    hotColumn.index = 1;
    const archivedColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    archivedColumn.index = 2;
    const flatFiles = makeFlatFiles();
    vi.mocked(flatFiles.getDataColumns).mockResolvedValue([flatColumn]);
    const store = new DataColumnStore(
      flatFiles,
      {
        values: vi.fn().mockResolvedValue([duplicateHotColumn, hotColumn]),
        getManyBinary: vi.fn(),
        deleteMany: vi.fn(),
      },
      {
        values: vi.fn().mockResolvedValue([hotColumn, archivedColumn]),
        getManyBinary: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      {getSlotByRoot: vi.fn().mockResolvedValue(10)}
    );

    await expect(store.getAll({slot: 10, blockRoot: ROOT})).resolves.toEqual([flatColumn, hotColumn, archivedColumn]);
  });

  it("should coordinate writes, deletion, and pruning across backends", async () => {
    const flatFiles = makeFlatFiles();
    const deleteHot = vi.fn().mockResolvedValue(undefined);
    const deleteArchive = vi.fn().mockResolvedValue(undefined);
    const store = new DataColumnStore(
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
    await store.pruneBefore(5);

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
    getDataColumnsBinary: vi.fn().mockResolvedValue([]),
    putDataColumnsBinary: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    pruneBefore: vi.fn().mockResolvedValue(undefined),
  };
}
