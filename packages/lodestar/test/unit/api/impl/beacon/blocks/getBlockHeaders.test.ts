import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";
import sinon, {SinonStubbedInstance} from "sinon";
import {ArrayDagLMDGHOST, BeaconChain, BlockSummary, IBeaconChain, ILMDGHOST} from "../../../../../../src/chain";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {Libp2pNetwork} from "../../../../../../src/network";
import {BeaconSync} from "../../../../../../src/sync";
import {
  generateBlockSummary,
  generateEmptyBlock,
  generateEmptyBlockSummary,
  generateEmptySignedBlock, generateSignedBlock
} from "../../../../../utils/block";
import deepmerge from "deepmerge";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {expect} from "chai";

describe("api - beacon - getBlockHeaders", function () {

  let blockApi: BeaconBlockApi;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;

  beforeEach(function () {
    forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    dbStub = new StubbedBeaconDb(sinon, config);
    blockApi = new BeaconBlockApi({}, {
      chain: chainStub,
      config,
      db: dbStub,
      logger: sinon.createStubInstance(WinstonLogger),
      network: sinon.createStubInstance(Libp2pNetwork),
      sync: sinon.createStubInstance(BeaconSync)
    });
  });

  it("no filters - assume head slot", async function () {
    forkChoiceStub.headBlockSlot.returns(1);
    chainStub.getBlockAtSlot.withArgs(1).resolves(generateEmptySignedBlock());
    forkChoiceStub.getBlockSummariesAtSlot.withArgs(1)
      .returns([
        generateEmptyBlockSummary(),
        //canonical block summary
        deepmerge<BlockSummary>(
          generateEmptyBlockSummary(),
          {blockRoot: config.types.BeaconBlock.hashTreeRoot(generateEmptyBlock())}
        )
      ]);
    dbStub.block.get.resolves(deepmerge(generateEmptySignedBlock(), {message: {slot: 3}}));
    dbStub.blockArchive.get.resolves(null);
    const blockHeaders = await blockApi.getBlockHeaders({});
    expect(blockHeaders).to.not.be.null;
    expect(blockHeaders.length).to.be.equal(2);
    expect(() => config.types.SignedBeaconHeaderResponse.assertValidValue(blockHeaders[0])).to.not.throw;
    expect(() => config.types.SignedBeaconHeaderResponse.assertValidValue(blockHeaders[1])).to.not.throw;
    expect(blockHeaders.filter((header) => header.canonical).length).to.be.equal(1);
    expect(forkChoiceStub.headBlockSlot.calledOnce).to.be.true;
    expect(chainStub.getBlockAtSlot.calledOnce).to.be.true;
    expect(forkChoiceStub.getBlockSummariesAtSlot.calledOnce).to.be.true;
    expect(dbStub.block.get.calledOnce).to.be.true;
  });

  it("future slot", async function () {
    forkChoiceStub.headBlockSlot.returns(1);
    const blockHeaders = await blockApi.getBlockHeaders({slot: 2});
    expect(blockHeaders.length).to.be.equal(0);
  });

  it("finalized slot", async function () {
    forkChoiceStub.headBlockSlot.returns(2);
    chainStub.getBlockAtSlot.withArgs(0).resolves(generateEmptySignedBlock());
    forkChoiceStub.getBlockSummariesAtSlot.withArgs(0).returns([]);
    const blockHeaders = await blockApi.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).to.be.equal(1);
    expect(() => config.types.SignedBeaconHeaderResponse.assertValidValue(blockHeaders[0])).to.not.throw;
    expect(blockHeaders[0].canonical).to.be.true;
  });

  it("skip slot", async function () {
    forkChoiceStub.headBlockSlot.returns(2);
    chainStub.getBlockAtSlot.withArgs(0).resolves(null);
    const blockHeaders = await blockApi.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).to.be.equal(0);
  });

  it("parent root filter - both finalized and non finalized results", async function() {
    dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    forkChoiceStub.getBlockSummaryByParentBlockRoot.returns([
      generateBlockSummary({slot: 2}),
      generateBlockSummary({slot: 1}),
    ]);
    const cannonical = generateSignedBlock({message: {slot: 2}});
    forkChoiceStub.getCanonicalBlockSummaryAtSlot
      .withArgs(1)
      .returns(
        generateBlockSummary()
      );
    forkChoiceStub.getCanonicalBlockSummaryAtSlot
      .withArgs(2)
      .returns(
        generateBlockSummary({blockRoot: config.types.BeaconBlock.hashTreeRoot(cannonical.message)})
      );
    dbStub.block.get.onFirstCall().resolves(generateSignedBlock({message: {slot: 1}}));
    dbStub.block.get.onSecondCall().resolves(generateSignedBlock({message: {slot: 2}}));
    const blockHeaders = await blockApi.getBlockHeaders({parentRoot: Buffer.alloc(32, 1)});
    expect(blockHeaders.length).to.equal(3);
    expect(blockHeaders.filter(b => b.canonical).length).to.equal(2);
  });

  it("parent root - no finalized block", async function() {
    dbStub.blockArchive.getByParentRoot.resolves(null);
    forkChoiceStub.getBlockSummaryByParentBlockRoot.returns([
      generateBlockSummary({slot: 1}),
    ]);
    forkChoiceStub.getCanonicalBlockSummaryAtSlot
      .withArgs(1)
      .returns(
        generateBlockSummary()
      );
    dbStub.block.get.resolves(generateSignedBlock({message: {slot: 1}}));
    const blockHeaders = await blockApi.getBlockHeaders({parentRoot: Buffer.alloc(32, 1)});
    expect(blockHeaders.length).to.equal(1);
  });

  it("parent root - no non finalized blocks", async function() {
    dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    forkChoiceStub.getBlockSummaryByParentBlockRoot.returns([]);
    const blockHeaders = await blockApi.getBlockHeaders({parentRoot: Buffer.alloc(32, 1)});
    expect(blockHeaders.length).to.equal(1);
  });

  it("parent root + slot filter", async function() {
    dbStub.blockArchive.getByParentRoot.resolves(generateEmptySignedBlock());
    forkChoiceStub.getBlockSummaryByParentBlockRoot.returns([
      generateBlockSummary({slot: 2}),
      generateBlockSummary({slot: 1}),
    ]);
    const cannonical = generateSignedBlock({message: {slot: 2}});
    forkChoiceStub.getCanonicalBlockSummaryAtSlot
      .withArgs(1)
      .returns(
        generateBlockSummary()
      );
    forkChoiceStub.getCanonicalBlockSummaryAtSlot
      .withArgs(2)
      .returns(
        generateBlockSummary({blockRoot: config.types.BeaconBlock.hashTreeRoot(cannonical.message)})
      );
    dbStub.block.get.onFirstCall().resolves(generateSignedBlock({message: {slot: 1}}));
    dbStub.block.get.onSecondCall().resolves(generateSignedBlock({message: {slot: 2}}));
    const blockHeaders = await blockApi.getBlockHeaders({parentRoot: Buffer.alloc(32, 1), slot: 1});
    expect(blockHeaders.length).to.equal(1);
  });
});
