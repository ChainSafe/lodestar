import {describe, it} from "mocha";
import {BlockArchiveRepository} from "../../../../../src/db/api/beacon/repositories/blockArchive";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {LevelDbController} from "../../../../../src/db/controller";
import sinon from "sinon";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {expect} from "chai";
import pipe from "it-pipe";
import {collect} from "../../../chain/blocks/utils";
import pushable from "it-pushable";

describe("block archive repository", function () {
   
  it("should add multiple blocks", async function () {
    const controllerStub = sinon.createStubInstance(LevelDbController);
    const archive = new BlockArchiveRepository(config, controllerStub);
    await archive.addMany([generateEmptySignedBlock(), generateEmptySignedBlock()]);
    expect(controllerStub.batchPut.withArgs(sinon.match((criteria) => criteria.length === 2)).calledOnce).to.be.true;
  });
   
  it("should fetch block stream", async function () {
    const controllerStub = sinon.createStubInstance(LevelDbController);
    const archive = new BlockArchiveRepository(config, controllerStub);
    const blockSource = pushable();
    controllerStub.searchStream.returns(blockSource);
    blockSource.push(config.types.SignedBeaconBlock.serialize(generateEmptySignedBlock()));
    blockSource.push(config.types.SignedBeaconBlock.serialize(generateEmptySignedBlock()));
    blockSource.end();
    const result = await pipe(
      archive.getAllBetweenStream(0, 1, 1),
      collect
    );
    expect(result.length).to.be.equal(2);
  });
    
});
