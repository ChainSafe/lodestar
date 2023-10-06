import sinon, {SinonStubbedInstance} from "sinon";
import all from "it-all";

import {ContainerType} from "@chainsafe/ssz";
import {Bytes32, ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {Db, LevelDbController, Repository} from "@lodestar/db";
import {Bucket} from "../../../../src/db/buckets.js";

interface TestType {
  bool: boolean;
  bytes: Bytes32;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const TestSSZType = new ContainerType({
  bool: ssz.Boolean,
  bytes: ssz.Bytes32,
});

class TestRepository extends Repository<string, TestType> {
  constructor(db: Db) {
    super(config, db, Bucket.phase0_depositEvent, TestSSZType, "phase0_depositEvent");
  }
}

describe("database repository", function () {
  const sandbox = sinon.createSandbox();

  let repository: TestRepository, controller: SinonStubbedInstance<LevelDbController>;

  beforeEach(function () {
    controller = sandbox.createStubInstance(LevelDbController);
    repository = new TestRepository(controller);
  });

  it("should get single item", async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    controller.get.resolves(TestSSZType.serialize(item) as Buffer);
    const result = await repository.get("id");
    expect(result).toEqual(item);
    expect(controller.get).toHaveBeenCalledTimes(1);
  });

  it("should return null if item not found", async function () {
    controller.get.resolves(null);
    const result = await repository.get("id");
    expect(result).toEqual(null);
    expect(controller.get).toHaveBeenCalledTimes(1);
  });

  it("should return true if item exists", async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    controller.get.resolves(TestSSZType.serialize(item) as Buffer);
    const result = await repository.has("id");
    expect(result).toBe(true);
    expect(controller.get).toHaveBeenCalledTimes(1);
  });

  it("should return false if item doesnt exists", async function () {
    controller.get.resolves(null);
    const result = await repository.has("id");
    expect(result).toBe(false);
    expect(controller.get).toHaveBeenCalledTimes(1);
  });

  it("should store with hashTreeRoot as id", async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await expect(repository.add(item)).to.not.be.rejected;
    expect(controller.put).toHaveBeenCalledTimes(1);
  });

  it("should store with given id", async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await expect(repository.put("1", item)).to.not.be.rejected;
    expect(controller.put).toHaveBeenCalledTimes(1);
  });

  it("should delete", async function () {
    await expect(repository.delete("1")).to.not.be.rejected;
    expect(controller.delete).toHaveBeenCalledTimes(1);
  });

  it("should return all items", async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    const itemSerialized = TestSSZType.serialize(item);
    const items = [itemSerialized, itemSerialized, itemSerialized];
    controller.values.resolves(items as Buffer[]);
    const result = await repository.values();
    expect(result).toEqual([item, item, item]);
    expect(controller.values).toHaveBeenCalledTimes(1);
  });

  it("should return range of items", async function () {
    await repository.values({gt: "a", lt: "b"});
    expect(controller.values).toHaveBeenCalledTimes(1);
  });

  it("should delete given items", async function () {
    await repository.batchDelete(["1", "2", "3"]);
    expect(controller.batchDelete).to.be.calledOnceWith(sinon.match((criteria: unknown[]) => criteria.length === 3));
  });

  it("should delete given items by value", async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await repository.batchRemove([item, item]);
    expect(controller.batchDelete).to.be.calledOnceWith(sinon.match((criteria: unknown[]) => criteria.length === 2));
  });

  it("should add multiple values", async function () {
    await repository.batchAdd([
      {bool: true, bytes: Buffer.alloc(32)},
      {bool: false, bytes: Buffer.alloc(32)},
    ]);
    expect(controller.batchPut).to.be.calledOnceWith(sinon.match((criteria: unknown[]) => criteria.length === 2));
  });

  it("should fetch values stream", async function () {
    async function* sample(): AsyncGenerator<Buffer> {
      yield TestSSZType.serialize({bool: true, bytes: Buffer.alloc(32)}) as Buffer;
      yield TestSSZType.serialize({bool: false, bytes: Buffer.alloc(32)}) as Buffer;
    }

    controller.valuesStream.returns(sample());

    const result = await all(repository.valuesStream());
    expect(result.length).toBe(2);
  });
});
