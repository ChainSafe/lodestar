import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {config} from "@chainsafe/lodestar-config/minimal";
import {
  generateBlockSummary,
  generateEmptyBlock,
  generateEmptyBlockSummary,
  generateEmptySignedBlock,
  generateSignedBlock,
} from "../../../../../utils/block";
import deepmerge from "deepmerge";
import {expect} from "chai";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";

describe("api - beacon - getBlockHeaders", function () {
  let server: ApiImplTestModules;

  beforeEach(function () {
    server = setupApiImplTestServer();
    server.chainStub.forkChoice = server.forkChoiceStub;
  });

  it("no filters - assume head slot", async function () {
    server.forkChoiceStub.getHead.returns(generateBlockSummary({slot: 1}));
    server.chainStub.getCanonicalBlockAtSlot.withArgs(1).resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesAtSlot.withArgs(1).returns([
      generateEmptyBlockSummary(),
      //canonical block summary
      deepmerge<IBlockSummary>(generateEmptyBlockSummary(), {
        blockRoot: config.types.phase0.BeaconBlock.hashTreeRoot(generateEmptyBlock()),
      }),
    ]);
    server.dbStub.block.get.resolves(deepmerge(generateEmptySignedBlock(), {message: {slot: 3}}));
    server.dbStub.blockArchive.get.resolves(null);
    const blockHeaders = await server.blockApi.getBlockHeaders({});
    expect(blockHeaders).to.not.be.null;
    expect(blockHeaders.length).to.be.equal(2);
    expect(() => config.types.phase0.SignedBeaconHeaderResponse.assertValidValue(blockHeaders[0])).to.not.throw;
    expect(() => config.types.phase0.SignedBeaconHeaderResponse.assertValidValue(blockHeaders[1])).to.not.throw;
    expect(blockHeaders.filter((header) => header.canonical).length).to.be.equal(1);
    expect(server.forkChoiceStub.getHead.calledOnce).to.be.true;
    expect(server.chainStub.getCanonicalBlockAtSlot.calledOnce).to.be.true;
    expect(server.forkChoiceStub.getBlockSummariesAtSlot.calledOnce).to.be.true;
    expect(server.dbStub.block.get.calledOnce).to.be.true;
  });

  it("future slot", async function () {
    server.forkChoiceStub.getHead.returns(generateBlockSummary({slot: 1}));
    const blockHeaders = await server.blockApi.getBlockHeaders({slot: 2});
    expect(blockHeaders.length).to.be.equal(0);
  });

  it("finalized slot", async function () {
    server.forkChoiceStub.getHead.returns(generateBlockSummary({slot: 2}));
    server.chainStub.getCanonicalBlockAtSlot.withArgs(0).resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesAtSlot.withArgs(0).returns([]);
    const blockHeaders = await server.blockApi.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).to.be.equal(1);
    expect(() => config.types.phase0.SignedBeaconHeaderResponse.assertValidValue(blockHeaders[0])).to.not.throw;
    expect(blockHeaders[0].canonical).to.be.true;
  });

  it("skip slot", async function () {
    server.forkChoiceStub.getHead.returns(generateBlockSummary({slot: 2}));
    server.chainStub.getCanonicalBlockAtSlot.withArgs(0).resolves(null);
    const blockHeaders = await server.blockApi.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).to.be.equal(0);
  });

  it("parent root filter - both finalized and non finalized results", async function () {
    server.dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesByParentRoot.returns([
      generateBlockSummary({slot: 2}),
      generateBlockSummary({slot: 1}),
    ]);
    const cannonical = generateSignedBlock({message: {slot: 2}});
    server.forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(1).returns(generateBlockSummary());
    server.forkChoiceStub.getCanonicalBlockSummaryAtSlot
      .withArgs(2)
      .returns(generateBlockSummary({blockRoot: config.types.phase0.BeaconBlock.hashTreeRoot(cannonical.message)}));
    server.dbStub.block.get.onFirstCall().resolves(generateSignedBlock({message: {slot: 1}}));
    server.dbStub.block.get.onSecondCall().resolves(generateSignedBlock({message: {slot: 2}}));
    const blockHeaders = await server.blockApi.getBlockHeaders({parentRoot: Buffer.alloc(32, 1)});
    expect(blockHeaders.length).to.equal(3);
    expect(blockHeaders.filter((b) => b.canonical).length).to.equal(2);
  });

  it("parent root - no finalized block", async function () {
    server.dbStub.blockArchive.getByParentRoot.resolves(null);
    server.forkChoiceStub.getBlockSummariesByParentRoot.returns([generateBlockSummary({slot: 1})]);
    server.forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(1).returns(generateBlockSummary());
    server.dbStub.block.get.resolves(generateSignedBlock({message: {slot: 1}}));
    const blockHeaders = await server.blockApi.getBlockHeaders({parentRoot: Buffer.alloc(32, 1)});
    expect(blockHeaders.length).to.equal(1);
  });

  it("parent root - no non finalized blocks", async function () {
    server.dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesByParentRoot.returns([]);
    const blockHeaders = await server.blockApi.getBlockHeaders({parentRoot: Buffer.alloc(32, 1)});
    expect(blockHeaders.length).to.equal(1);
  });

  it("parent root + slot filter", async function () {
    server.dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    server.forkChoiceStub.getBlockSummariesByParentRoot.returns([
      generateBlockSummary({slot: 2}),
      generateBlockSummary({slot: 1}),
    ]);
    const cannonical = generateSignedBlock({message: {slot: 2}});
    server.forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(1).returns(generateBlockSummary());
    server.forkChoiceStub.getCanonicalBlockSummaryAtSlot
      .withArgs(2)
      .returns(generateBlockSummary({blockRoot: config.types.phase0.BeaconBlock.hashTreeRoot(cannonical.message)}));
    server.dbStub.block.get.onFirstCall().resolves(generateSignedBlock({message: {slot: 1}}));
    server.dbStub.block.get.onSecondCall().resolves(generateSignedBlock({message: {slot: 2}}));
    const blockHeaders = await server.blockApi.getBlockHeaders({parentRoot: Buffer.alloc(32, 1), slot: 1});
    expect(blockHeaders.length).to.equal(1);
  });
});
