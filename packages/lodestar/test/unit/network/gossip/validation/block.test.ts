import * as specUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/block";
import {validateGossipBlock} from "../../../../../src/network/gossip/validation";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {ArrayDagLMDGHOST, BeaconChain, IBeaconChain, ILMDGHOST} from "../../../../../src/chain";
import {generateSignedBlock} from "../../../../utils/block";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {ExtendedValidatorResult} from "../../../../../src/network/gossip/constants";
import {expect} from "chai";
import * as blockValidationUtils from "../../../../../src/network/gossip/utils";
import {generateState} from "../../../../utils/state";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {silentLogger} from "../../../../utils/logger";

describe("gossip block validation", function () {
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
  let dbStub: StubbedBeaconDb;
  let getBlockContextStub: SinonStub;
  let verifySignatureStub: SinonStub;
  const logger = silentLogger;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
    chainStub.forkChoice = forkChoiceStub;
    dbStub = new StubbedBeaconDb(sinon, config);
    getBlockContextStub = sinon.stub(blockValidationUtils, "getBlockStateContext");
    verifySignatureStub = sinon.stub(specUtils, "verifyBlockSignature");
  });

  afterEach(function () {
    getBlockContextStub.restore();
    verifySignatureStub.restore();
  });

  it("block slot is finalized", async function () {
    const block = generateSignedBlock();
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 1,
      root: Buffer.alloc(32),
    });
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.notCalled).to.be.true;
  });

  it("bad block", async function () {
    chainStub.getGenesisTime.returns(Date.now() / 1000 - config.params.SECONDS_PER_SLOT);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(true);
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(chainStub.getCanonicalBlockAtSlot.notCalled).to.be.true;
  });

  it("already proposed", async function () {
    chainStub.getGenesisTime.returns(Date.now() / 1000 - config.params.SECONDS_PER_SLOT);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    chainStub.getCanonicalBlockAtSlot.resolves(
      generateSignedBlock({message: {proposerIndex: block.message.proposerIndex}})
    );
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(chainStub.getCanonicalBlockAtSlot.withArgs(block.message.slot).calledOnce).to.be.true;
    expect(getBlockContextStub.notCalled).to.be.true;
  });

  it("missing parent", async function () {
    chainStub.getGenesisTime.returns(Date.now() / 1000 - config.params.SECONDS_PER_SLOT);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    chainStub.getCanonicalBlockAtSlot.resolves(null);
    getBlockContextStub.resolves(null);
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(chainStub.getCanonicalBlockAtSlot.withArgs(block.message.slot).calledOnce).to.be.true;
    expect(getBlockContextStub.calledOnce).to.be.true;
    expect(chainStub.receiveBlock.calledOnce).to.be.true;
  });

  it("invalid signature", async function () {
    chainStub.getGenesisTime.returns(Date.now() / 1000 - config.params.SECONDS_PER_SLOT);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    chainStub.getCanonicalBlockAtSlot.resolves(null);
    getBlockContextStub.resolves({
      state: generateState(),
      epochCtx: new EpochContext(config),
    });
    verifySignatureStub.returns(false);
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(chainStub.getCanonicalBlockAtSlot.withArgs(block.message.slot).calledOnce).to.be.true;
    expect(getBlockContextStub.calledOnce).to.be.true;
    expect(chainStub.receiveBlock.calledOnce).to.be.false;
    expect(verifySignatureStub.calledOnce).to.be.true;
  });

  it("wrong proposer", async function () {
    chainStub.getGenesisTime.returns(Date.now() / 1000 - config.params.SECONDS_PER_SLOT);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    chainStub.getCanonicalBlockAtSlot.resolves(null);
    const epochCtxStub = sinon.createStubInstance(EpochContext);
    getBlockContextStub.resolves({
      state: generateState(),
      epochCtx: epochCtxStub,
    });
    verifySignatureStub.returns(true);
    epochCtxStub.getBeaconProposer.returns(block.message.proposerIndex + 1);
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(chainStub.getCanonicalBlockAtSlot.withArgs(block.message.slot).calledOnce).to.be.true;
    expect(getBlockContextStub.calledOnce).to.be.true;
    expect(chainStub.receiveBlock.calledOnce).to.be.false;
    expect(verifySignatureStub.calledOnce).to.be.true;
    expect(epochCtxStub.getBeaconProposer.withArgs(block.message.slot).calledOnce).to.be.true;
  });

  it("valid block", async function () {
    chainStub.getGenesisTime.returns(Date.now() / 1000 - config.params.SECONDS_PER_SLOT);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    chainStub.getCanonicalBlockAtSlot.resolves(null);
    const epochCtxStub = sinon.createStubInstance(EpochContext);
    getBlockContextStub.resolves({
      state: generateState(),
      epochCtx: epochCtxStub,
    });
    verifySignatureStub.returns(true);
    epochCtxStub.getBeaconProposer.returns(block.message.proposerIndex);
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.accept);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(chainStub.getCanonicalBlockAtSlot.withArgs(block.message.slot).calledOnce).to.be.true;
    expect(getBlockContextStub.calledOnce).to.be.true;
    expect(verifySignatureStub.calledOnce).to.be.true;
    expect(epochCtxStub.getBeaconProposer.withArgs(block.message.slot).calledOnce).to.be.true;
  });
});
