import {beforeEach, describe, it} from "mocha";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {LevelDbController} from "../../../../../src/db/controller";
import sinon from "sinon";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {expect} from "chai";
import {BlockRepository} from "../../../../../src/db/api/beacon/repositories";
import {ChainRepository} from "../../../../../src/db/api/beacon/repositories";
import {Bucket, encodeKey} from "../../../../../src/db/schema";

describe("block repository", function () {

  const sandbox = sinon.createSandbox();

  let controllerStub: any, chainStub: any;

  beforeEach(function () {
    controllerStub = sandbox.createStubInstance(LevelDbController);
    chainStub = sandbox.createStubInstance(ChainRepository);
  });

  it("should add block refs", async function () {
    const blockRepo = new BlockRepository(config, controllerStub, chainStub);
    const block = generateEmptySignedBlock();
    await blockRepo.set(Buffer.alloc(32), block);
    expect(
      controllerStub.put.withArgs(encodeKey(Bucket.blockSlotRefs, block.message.slot), sinon.match.any).calledOnce
    ).to.be.true;
    expect(
      controllerStub.put.withArgs(encodeKey(Bucket.blockRootRefs, Buffer.alloc(32)), sinon.match.any).calledOnce
    ).to.be.true;
  });
    
});
