import sinon, {SinonStubbedInstance} from "sinon";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import pushable, {Pushable} from "it-pushable";

import {ContainerType} from "@chainsafe/ssz";
import {Bytes32} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

import {Repository} from "../../../../src/db/api/beacon/repositories";
import {IDatabaseController, LevelDbController} from "../../../../src/db/controller";
import {Bucket} from "../../../../src/db/api/schema";

chai.use(chaiAsPromised);

interface TestType {
  bool: boolean;
  bytes: Bytes32;
}

const TestSSZType = new ContainerType<TestType>({
  fields: {
    bool: config.types.Boolean,
    bytes: config.types.Bytes32,
  },
});

class TestRepository extends Repository<string, TestType> {
  public constructor(db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.depositData, TestSSZType);
  }
}

describe("database repository", function () {

  const sandbox = sinon.createSandbox();

  let repository: TestRepository, controller: SinonStubbedInstance<LevelDbController>;

  beforeEach(function () {
    controller = sandbox.createStubInstance(LevelDbController);
    repository = new TestRepository(controller);
  });

  it("should get single item", async function() {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    controller.get.resolves(TestSSZType.serialize(item) as Buffer);
    const result = await repository.get("id");
    expect(result).to.be.deep.equal(item);
    expect(controller.get.calledOnce).to.be.true;
  });

  it("should return null if item not found", async function() {
    controller.get.resolves(null);
    const result = await repository.get("id");
    expect(result).to.be.deep.equal(null);
    expect(controller.get.calledOnce).to.be.true;
  });

  it("should return true if item exists", async function() {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    controller.get.resolves(TestSSZType.serialize(item) as Buffer);
    const result = await repository.has("id");
    expect(result).to.be.true;
    expect(controller.get.calledOnce).to.be.true;
  });

  it("should return false if item doesnt exists", async function() {
    controller.get.resolves(null);
    const result = await repository.has("id");
    expect(result).to.be.false;
    expect(controller.get.calledOnce).to.be.true;
  });

  it("should store with hashTreeRoot as id", async function() {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await expect(repository.add(item)).to.not.be.rejected;
    expect(controller.put.calledOnce).to.be.true;
  });

  it("should store with given id", async function() {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await expect(repository.put("1", item)).to.not.be.rejected;
    expect(controller.put.calledOnce).to.be.true;
  });

  it("should delete", async function() {
    await expect(repository.delete("1")).to.not.be.rejected;
    expect(controller.delete.calledOnce).to.be.true;
  });

  it("should return all items", async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    const itemSerialized = TestSSZType.serialize(item);
    const items = [itemSerialized, itemSerialized, itemSerialized];
    controller.values.resolves(items as Buffer[]);
    const result = await repository.values();
    expect(result).to.be.deep.equal([item, item, item]);
    expect(controller.values.calledOnce).to.be.true;
  });

  it("should return range of items", async function () {
    await repository.values({gt: "a", lt: "b"});
    expect(controller.values.calledOnce).to.be.true;
  });

  it("should delete given items", async function () {
    await repository.batchDelete(["1", "2", "3"]);
    expect(
      controller
        .batchDelete
        .withArgs(
          sinon.match((criteria) => criteria.length === 3)
        ).calledOnce
    ).to.be.true;
  });

  it("should delete given items by value", async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await repository.batchRemove([item, item]);
    expect(
      controller
        .batchDelete
        .withArgs(
          sinon.match((criteria) => criteria.length === 2)
        ).calledOnce
    ).to.be.true;
  });

  it("should add multiple values", async function () {
    await repository.batchAdd([
      {bool: true, bytes: Buffer.alloc(32)},
      {bool: false, bytes: Buffer.alloc(32)},
    ]);
    expect(controller.batchPut.withArgs(sinon.match(criteria => criteria.length === 2)).calledOnce).to.be.true;
  });

  it("should fetch values stream", async function () {
    const source: Pushable<Buffer> = pushable();
    controller.valuesStream.returns(source);

    source.push(TestSSZType.serialize({bool: true, bytes: Buffer.alloc(32)}) as Buffer);
    source.push(TestSSZType.serialize({bool: false, bytes: Buffer.alloc(32)}) as Buffer);
    source.end();

    const result = [];
    for await (const v of repository.valuesStream()) {
      result.push(v);
    }
    expect(result.length).to.be.equal(2);
  });
});
