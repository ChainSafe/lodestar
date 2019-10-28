import {describe, it} from "mocha";
import {BlockArchiveRepository} from "../../../../../src/db/api/beacon/repositories/blockArhive";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {LevelDbController} from "../../../../../src/db/controller";
import sinon from "sinon";
import {generateEmptyBlock} from "../../../../utils/block";
import {expect} from "chai";

describe("block archive repository", function () {
   
  it("should add multiple blocks", async function () {
    const controllerStub = sinon.createStubInstance(LevelDbController);
    const archive = new BlockArchiveRepository(config, controllerStub);
    await archive.addMultiple([generateEmptyBlock(), generateEmptyBlock()]);
    expect(controllerStub.batchPut.withArgs(sinon.match((criteria) => criteria.length === 2)).calledOnce).to.be.true;
  });
    
});