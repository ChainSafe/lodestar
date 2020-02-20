import sinon from "sinon";
import chai, {expect} from "chai";
import chaiAsPromised from 'chai-as-promised';

import {ContainerType} from "@chainsafe/ssz";
import {Bytes32} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {BulkRepository} from "../../../../src/db/api/beacon/repository";
import {IDatabaseController, LevelDbController} from "../../../../src/db/controller";
import {Bucket} from "../../../../src/db/schema";

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

class TestRepository extends BulkRepository<TestType> {

  public constructor(db: IDatabaseController) {
    super(config, db, Bucket.depositData, TestSSZType);
  }

}

describe('database repository', function () {

  const sandbox = sinon.createSandbox();

  let repository: TestRepository, controller;

  beforeEach(function () {
    controller = sandbox.createStubInstance(LevelDbController);
    repository = new TestRepository(controller);
  });

  it('should get single item', async function() {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    controller.get.resolves(TestSSZType.serialize(item));
    const result = await repository.get('id');
    expect(result).to.be.deep.equal(item);
    expect(controller.get.calledOnce).to.be.true;
  });

  it('should return null if item not found', async function() {
    controller.get.resolves(null);
    const result = await repository.get('id');
    expect(result).to.be.deep.equal(null);
    expect(controller.get.calledOnce).to.be.true;
  });

  it('should return true if item exists', async function() {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    controller.get.resolves(TestSSZType.serialize(item));
    const result = await repository.has('id');
    expect(result).to.be.true;
    expect(controller.get.calledOnce).to.be.true;
  });

  it('should return false if item doesnt exists', async function() {
    controller.get.resolves(null);
    const result = await repository.has('id');
    expect(result).to.be.false;
    expect(controller.get.calledOnce).to.be.true;
  });

  it('should store with hashTreeRoot as id', async function() {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await expect(repository.add(item)).to.not.be.rejected;
    expect(controller.put.calledOnce).to.be.true;
  });

  it('should store with given id', async function() {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await expect(repository.set(1, item)).to.not.be.rejected;
    expect(controller.put.calledOnce).to.be.true;
  });

  it('should delete', async function() {
    await expect(repository.delete(1)).to.not.be.rejected;
    expect(controller.delete.calledOnce).to.be.true;
  });

  it('should return all items', async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    const itemSerialized = TestSSZType.serialize(item);
    const items = [itemSerialized, itemSerialized, itemSerialized];
    controller.search.resolves(items);
    const result = await repository.getAll();
    expect(result).to.be.deep.equal([item, item, item]);
    expect(controller.search.calledOnce).to.be.true;
  });

  it('should return range of items', async function () {
    await repository.getAllBetween(0, 1);
    expect(controller.search.calledOnce).to.be.true;
  });

  it('should delete given items', async function () {
    await repository.deleteMany([1, 2, 3]);
    expect(
      controller
        .batchDelete
        .withArgs(
          sinon.match((criteria) => criteria.length === 3)
        ).calledOnce
    ).to.be.true;
  });

  it('should delete given items by value', async function () {
    const item = {bool: true, bytes: Buffer.alloc(32)};
    await repository.deleteManyByValue([item, item]);
    expect(
      controller
        .batchDelete
        .withArgs(
          sinon.match((criteria) => criteria.length === 2)
        ).calledOnce
    ).to.be.true;
  });
});
