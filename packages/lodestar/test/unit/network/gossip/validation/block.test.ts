import {expect} from "chai";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import * as specUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/block";

import {BeaconChain, ForkChoice, IBeaconChain} from "../../../../../src/chain";
import {LocalClock} from "../../../../../src/chain/clock";
import {StateRegenerator} from "../../../../../src/chain/regen";
import {ExtendedValidatorResult} from "../../../../../src/network/gossip/constants";
import {validateGossipBlock} from "../../../../../src/network/gossip/validation";
import {generateSignedBlock} from "../../../../utils/block";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {generateState} from "../../../../utils/state";
import {silentLogger} from "../../../../utils/logger";

describe("gossip block validation", function () {
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let regenStub: SinonStubbedInstance<StateRegenerator>;
  let dbStub: StubbedBeaconDb;
  let verifySignatureStub: SinonStub;
  const logger = silentLogger;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.clock = sinon.createStubInstance(LocalClock);
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    chainStub.forkChoice = forkChoiceStub;
    regenStub = chainStub.regen = sinon.createStubInstance(StateRegenerator);
    dbStub = new StubbedBeaconDb(sinon, config);
    verifySignatureStub = sinon.stub(specUtils, "verifyBlockSignature");
  });

  afterEach(function () {
    verifySignatureStub.restore();
  });

  it("should ignore - block slot is finalized", async function () {
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

  it("should reject - bad block", async function () {
    sinon.stub(chainStub.clock, "currentSlot").get(() => 1);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(true);
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(chainStub.getCanonicalBlockAtSlot.notCalled).to.be.true;
  });

  it("should ignore - already proposed", async function () {
    sinon.stub(chainStub.clock, "currentSlot").get(() => 1);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    dbStub.block.get.resolves(generateSignedBlock({message: {proposerIndex: block.message.proposerIndex}}));
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.notCalled).to.be.true;
  });

  it("should ignore - missing parent", async function () {
    sinon.stub(chainStub.clock, "currentSlot").get(() => 1);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    dbStub.block.get.resolves(null);
    regenStub.getBlockSlotState.throws();
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(chainStub.receiveBlock.calledOnce).to.be.true;
  });

  it("should reject - invalid signature", async function () {
    sinon.stub(chainStub.clock, "currentSlot").get(() => 1);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    dbStub.block.get.resolves(null);
    regenStub.getBlockSlotState.resolves({
      state: generateState(),
      epochCtx: new EpochContext(config),
    });
    verifySignatureStub.returns(false);
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(chainStub.receiveBlock.calledOnce).to.be.false;
    expect(verifySignatureStub.calledOnce).to.be.true;
  });

  it("should reject - wrong proposer", async function () {
    sinon.stub(chainStub.clock, "currentSlot").get(() => 1);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    dbStub.block.get.resolves(null);
    const epochCtxStub = sinon.createStubInstance(EpochContext);
    regenStub.getBlockSlotState.resolves({
      state: generateState(),
      epochCtx: (epochCtxStub as unknown) as EpochContext,
    });
    verifySignatureStub.returns(true);
    epochCtxStub.getBeaconProposer.returns(block.message.proposerIndex + 1);
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(chainStub.receiveBlock.calledOnce).to.be.false;
    expect(verifySignatureStub.calledOnce).to.be.true;
    expect(epochCtxStub.getBeaconProposer.withArgs(block.message.slot).calledOnce).to.be.true;
  });

  it("should accept - valid block", async function () {
    sinon.stub(chainStub.clock, "currentSlot").get(() => 1);
    const block = generateSignedBlock({message: {slot: 1}});
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    chainStub.getCanonicalBlockAtSlot.resolves(null);
    forkChoiceStub.isDescendantOfFinalized.returns(true);
    const epochCtxStub = sinon.createStubInstance(EpochContext);
    regenStub.getBlockSlotState.resolves({
      state: generateState(),
      epochCtx: (epochCtxStub as unknown) as EpochContext,
    });
    verifySignatureStub.returns(true);
    epochCtxStub.getBeaconProposer.returns(block.message.proposerIndex);
    forkChoiceStub.getAncestor.resolves(Buffer.alloc(32));
    const result = await validateGossipBlock(config, chainStub, dbStub, logger, block);
    expect(result).to.equal(ExtendedValidatorResult.accept);
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(verifySignatureStub.calledOnce).to.be.true;
    expect(epochCtxStub.getBeaconProposer.withArgs(block.message.slot).calledOnce).to.be.true;
  });
});
