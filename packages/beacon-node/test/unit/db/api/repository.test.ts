import all from "it-all";
import {ContainerType} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, vi, afterEach, MockedObject} from "vitest";
import {Bytes32, ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {Db, LevelDbController, Repository} from "@lodestar/db";
import {Bucket} from "../../../../src/db/buckets.js";

vi.mock("@lodestar/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@lodestar/db")>();

  return {
    ...mod,
    LevelDbController: vi.spyOn(mod, "LevelDbController").mockImplementation(() => {
      return {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        values: vi.fn(),
        valuesStream: vi.fn(),
        batchDelete: vi.fn(),
        batchPut: vi.fn(),
      } as unknown as LevelDbController;
    }),
  };
});

interface TestType {
  bool: boolean;
  bytes: Bytes32;
}

const TestSSZType = new ContainerType({
  bool: ssz.Boolean,
  bytes: ssz.Bytes32,
});

class TestRepository extends Repository<string, TestType> {
  constructor(db: Db) {
    super(config, db, Bucket.phase0_depositEvent, TestSSZType, "phase0_depositEvent");
  }
}

describe("database repository", () => {
  let repository: TestRepository, controller: MockedObject<LevelDbController>;

  beforeEach(() => {
    controller = vi.mocked(new LevelDbController({} as any, {} as any, {} as any));
    repository = new TestRepository(controller as unknown as LevelDbController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should get single item", async () => {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    controller.get.mockResolvedValue(TestSSZType.serialize(item) as Buffer);
    const result = await repository.get("id");
    expect(item).toEqual({...result, bytes: Buffer.from(result?.bytes ?? [])});
    expect(controller.get).toHaveBeenCalledTimes(1);
  });

  it("should return null if item not found", async () => {
    controller.get.mockResolvedValue(null);
    const result = await repository.get("id");
    expect(result).toEqual(null);
    expect(controller.get).toHaveBeenCalledTimes(1);
  });

  it("should return true if item exists", async () => {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    controller.get.mockResolvedValue(TestSSZType.serialize(item) as Buffer);
    const result = await repository.has("id");
    expect(result).toBe(true);
    expect(controller.get).toHaveBeenCalledTimes(1);
  });

  it("should return false if item doesnt exists", async () => {
    controller.get.mockResolvedValue(null);
    const result = await repository.has("id");
    expect(result).toBe(false);
    expect(controller.get).toHaveBeenCalledTimes(1);
  });

  it("should store with hashTreeRoot as id", async () => {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await expect(repository.add(item)).resolves.toBeUndefined();
    expect(controller.put).toHaveBeenCalledTimes(1);
  });

  it("should store with given id", async () => {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await expect(repository.put("1", item)).resolves.toBeUndefined();
    expect(controller.put).toHaveBeenCalledTimes(1);
  });

  it("should delete", async () => {
    await expect(repository.delete("1")).resolves.toBeUndefined();
    expect(controller.delete).toHaveBeenCalledTimes(1);
  });

  it("should return all items", async () => {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    const itemSerialized = TestSSZType.serialize(item);
    const items = [itemSerialized, itemSerialized, itemSerialized];
    controller.values.mockResolvedValue(items as Buffer[]);
    const result = (await repository.values()).map((v) => ({...v, bytes: Buffer.from(v.bytes)}));
    expect(result).toEqual([item, item, item]);
    expect(controller.values).toHaveBeenCalledTimes(1);
  });

  it("should return range of items", async () => {
    await repository.values({gt: "a", lt: "b"});
    expect(controller.values).toHaveBeenCalledTimes(1);
  });

  it("should delete given items", async () => {
    await repository.batchDelete(["1", "2", "3"]);
    expect(controller.batchDelete.mock.calls[0][0]).toHaveLength(3);
  });

  it("should delete given items by value", async () => {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await repository.batchRemove([item, item]);

    expect(controller.batchDelete.mock.calls[0][0]).toHaveLength(2);
  });

  it("should add multiple values", async () => {
    await repository.batchAdd([
      {bool: true, bytes: Buffer.alloc(32)},
      {bool: false, bytes: Buffer.alloc(32)},
    ]);

    expect(controller.batchPut.mock.calls[0][0]).toHaveLength(2);
  });

  it("should fetch values stream", async () => {
    async function* sample(): AsyncGenerator<Buffer> {
      yield TestSSZType.serialize({bool: true, bytes: Buffer.alloc(32)}) as Buffer;
      yield TestSSZType.serialize({bool: false, bytes: Buffer.alloc(32)}) as Buffer;
    }

    controller.valuesStream.mockReturnValue(sample());
    const result = await all(repository.valuesStream());
    expect(result.length).toBe(2);
  });
});
