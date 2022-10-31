import {expect} from "chai";
import {ssz} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {
  generateProtoBlock,
  generateEmptyBlock,
  generateEmptyProtoBlock,
  generateEmptySignedBlock,
  generateSignedBlock,
} from "../../../../../utils/block.js";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test.js";

describe("api - beacon - getBlockHeaders", function () {
  let server: ApiImplTestModules;
  const parentRoot = toHexString(Buffer.alloc(32, 1));

  beforeEach(function () {
    server = setupApiImplTestServer();
    server.chainStub.forkChoice = server.forkChoiceStub;
  });

  it("no filters - assume head slot", async function () {
    server.forkChoiceStub.getHead.returns(generateProtoBlock({slot: 1}));
    server.chainStub.getCanonicalBlockAtSlot.withArgs(1).resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesAtSlot.withArgs(1).returns([
      generateEmptyProtoBlock(),
      //canonical block summary
      {
        ...generateEmptyProtoBlock(),
        blockRoot: toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(generateEmptyBlock())),
      },
    ]);

    const blockFromDb3 = generateEmptySignedBlock();
    blockFromDb3.message.slot = 3;
    server.dbStub.block.get.resolves(blockFromDb3);

    server.dbStub.blockArchive.get.resolves(null);
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({});
    expect(blockHeaders).to.not.be.null;
    expect(blockHeaders.length).to.be.equal(2);
    expect(blockHeaders.filter((header) => header.canonical).length).to.be.equal(1);
    expect(server.forkChoiceStub.getHead).to.be.calledOnce;
    expect(server.chainStub.getCanonicalBlockAtSlot).to.be.calledOnce;
    expect(server.forkChoiceStub.getBlockSummariesAtSlot).to.be.calledOnce;
    expect(server.dbStub.block.get).to.be.calledOnce;
  });

  it("future slot", async function () {
    server.forkChoiceStub.getHead.returns(generateProtoBlock({slot: 1}));
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({slot: 2});
    expect(blockHeaders.length).to.be.equal(0);
  });

  it("finalized slot", async function () {
    server.forkChoiceStub.getHead.returns(generateProtoBlock({slot: 2}));
    server.chainStub.getCanonicalBlockAtSlot.withArgs(0).resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesAtSlot.withArgs(0).returns([]);
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).to.be.equal(1);
    expect(blockHeaders[0].canonical).to.equal(true);
  });

  it("skip slot", async function () {
    server.forkChoiceStub.getHead.returns(generateProtoBlock({slot: 2}));
    server.chainStub.getCanonicalBlockAtSlot.withArgs(0).resolves(null);
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).to.be.equal(0);
  });

  it("parent root filter - both finalized and non finalized results", async function () {
    server.dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesByParentRoot.returns([
      generateProtoBlock({slot: 2}),
      generateProtoBlock({slot: 1}),
    ]);
    const cannonical = generateSignedBlock({message: {slot: 2}});
    server.forkChoiceStub.getCanonicalBlockAtSlot.withArgs(1).returns(generateProtoBlock());
    server.forkChoiceStub.getCanonicalBlockAtSlot
      .withArgs(2)
      .returns(generateProtoBlock({blockRoot: toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(cannonical.message))}));
    server.dbStub.block.get.onFirstCall().resolves(generateSignedBlock({message: {slot: 1}}));
    server.dbStub.block.get.onSecondCall().resolves(generateSignedBlock({message: {slot: 2}}));
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({parentRoot});
    expect(blockHeaders.length).to.equal(3);
    expect(blockHeaders.filter((b) => b.canonical).length).to.equal(2);
  });

  it("parent root - no finalized block", async function () {
    server.dbStub.blockArchive.getByParentRoot.resolves(null);
    server.forkChoiceStub.getBlockSummariesByParentRoot.returns([generateProtoBlock({slot: 1})]);
    server.forkChoiceStub.getCanonicalBlockAtSlot.withArgs(1).returns(generateProtoBlock());
    server.dbStub.block.get.resolves(generateSignedBlock({message: {slot: 1}}));
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({parentRoot});
    expect(blockHeaders.length).to.equal(1);
  });

  it("parent root - no non finalized blocks", async function () {
    server.dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesByParentRoot.returns([]);
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({parentRoot});
    expect(blockHeaders.length).to.equal(1);
  });

  it("parent root + slot filter", async function () {
    server.dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesByParentRoot.returns([
      generateProtoBlock({slot: 2}),
      generateProtoBlock({slot: 1}),
    ]);
    const cannonical = generateSignedBlock({message: {slot: 2}});
    server.forkChoiceStub.getCanonicalBlockAtSlot.withArgs(1).returns(generateProtoBlock());
    server.forkChoiceStub.getCanonicalBlockAtSlot
      .withArgs(2)
      .returns(generateProtoBlock({blockRoot: toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(cannonical.message))}));
    server.dbStub.block.get.onFirstCall().resolves(generateSignedBlock({message: {slot: 1}}));
    server.dbStub.block.get.onSecondCall().resolves(generateSignedBlock({message: {slot: 2}}));
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({
      parentRoot: toHexString(Buffer.alloc(32, 1)),
      slot: 1,
    });
    expect(blockHeaders.length).to.equal(1);
  });
});
