import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import * as specUtils from "@chainsafe/lodestar-beacon-state-transition/lib/phase0/fast/util/block";

import {BeaconChain, ForkChoice, IBeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock";
import {StateRegenerator} from "../../../../src/chain/regen";
import {validateGossipBlock} from "../../../../src/chain/validation";
import {generateSignedBlock, getNewBlockJob} from "../../../utils/block";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {BlockErrorCode} from "../../../../src/chain/errors";
import {SinonStubFn} from "../../../utils/types";
import {BlockError} from "../../../../src/chain/errors";

describe("gossip block validation", function () {
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let regenStub: SinonStubbedInstance<StateRegenerator>;
  let dbStub: StubbedBeaconDb;
  let verifySignatureStub: SinonStubFn<typeof specUtils["verifyBlockSignature"]>;

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

  it("should throw error - block slot is finalized", async function () {
    const signedBlock = generateSignedBlock();
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.returns({
      epoch: 1,
      root: Buffer.alloc(32),
    });
    try {
      await validateGossipBlock(config, chainStub, dbStub, job);
    } catch (error) {
      expect((error as BlockError).type).to.have.property("code", BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT);
    }
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.notCalled).to.be.true;
  });

  it("should throw error - bad block", async function () {
    sinon.stub(chainStub.clock, "currentSlotWithGossipDisparity").get(() => 1);
    const signedBlock = generateSignedBlock({message: {slot: 1}});
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.returns({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(true);
    try {
      await validateGossipBlock(config, chainStub, dbStub, job);
    } catch (error) {
      expect((error as BlockError).type).to.have.property("code", BlockErrorCode.KNOWN_BAD_BLOCK);
    }
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(chainStub.getCanonicalBlockAtSlot.notCalled).to.be.true;
  });

  it("should throw error - already proposed", async function () {
    sinon.stub(chainStub.clock, "currentSlotWithGossipDisparity").get(() => 1);
    const signedBlock = generateSignedBlock({message: {slot: 1}});
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.returns({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    dbStub.block.get.resolves(generateSignedBlock({message: {proposerIndex: signedBlock.message.proposerIndex}}));
    try {
      await validateGossipBlock(config, chainStub, dbStub, job);
    } catch (error) {
      expect((error as BlockError).type).to.have.property("code", BlockErrorCode.REPEAT_PROPOSAL);
    }
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.notCalled).to.be.true;
  });

  it("should throw error - missing parent", async function () {
    sinon.stub(chainStub.clock, "currentSlotWithGossipDisparity").get(() => 1);
    const signedBlock = generateSignedBlock({message: {slot: 1}});
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.returns({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    dbStub.block.get.resolves(null);
    regenStub.getBlockSlotState.throws();
    try {
      await validateGossipBlock(config, chainStub, dbStub, job);
    } catch (error) {
      expect((error as BlockError).type).to.have.property("code", BlockErrorCode.PARENT_UNKNOWN);
    }
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
  });

  it("should throw error - invalid signature", async function () {
    sinon.stub(chainStub.clock, "currentSlotWithGossipDisparity").get(() => 1);
    const signedBlock = generateSignedBlock({message: {slot: 1}});
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.returns({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    dbStub.block.get.resolves(null);
    regenStub.getBlockSlotState.resolves(generateCachedState());
    verifySignatureStub.returns(false);
    try {
      await validateGossipBlock(config, chainStub, dbStub, job);
    } catch (error) {
      expect((error as BlockError).type).to.have.property("code", BlockErrorCode.PROPOSAL_SIGNATURE_INVALID);
    }
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(chainStub.receiveBlock.calledOnce).to.be.false;
    expect(verifySignatureStub.calledOnce).to.be.true;
  });

  it("should throw error - wrong proposer", async function () {
    sinon.stub(chainStub.clock, "currentSlotWithGossipDisparity").get(() => 1);
    const signedBlock = generateSignedBlock({message: {slot: 1}});
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.returns({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    dbStub.block.get.resolves(null);
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getBeaconProposer").returns(signedBlock.message.proposerIndex + 1);
    regenStub.getBlockSlotState.resolves(state);
    verifySignatureStub.returns(true);
    try {
      await validateGossipBlock(config, chainStub, dbStub, job);
    } catch (error) {
      expect((error as BlockError).type).to.have.property("code", BlockErrorCode.INCORRECT_PROPOSER);
    }
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(chainStub.receiveBlock.calledOnce).to.be.false;
    expect(verifySignatureStub.calledOnce).to.be.true;
    expect(
      (state.epochCtx.getBeaconProposer as SinonStubFn<typeof state.epochCtx["getBeaconProposer"]>).withArgs(
        signedBlock.message.slot
      ).calledOnce
    ).to.be.true;
  });

  it("should accept - valid block", async function () {
    sinon.stub(chainStub.clock, "currentSlotWithGossipDisparity").get(() => 1);
    const signedBlock = generateSignedBlock({message: {slot: 1}});
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.resolves({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.badBlock.has.resolves(false);
    chainStub.getCanonicalBlockAtSlot.resolves(null);
    forkChoiceStub.isDescendantOfFinalized.returns(true);
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getBeaconProposer").returns(signedBlock.message.proposerIndex);
    regenStub.getBlockSlotState.resolves(state);
    verifySignatureStub.returns(true);
    forkChoiceStub.getAncestor.resolves(Buffer.alloc(32));
    const validationTest = await validateGossipBlock(config, chainStub, dbStub, job);
    expect(validationTest).to.not.throw;
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.badBlock.has.withArgs(sinon.match.defined).calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(verifySignatureStub.calledOnce).to.be.true;
    expect(
      (state.epochCtx.getBeaconProposer as SinonStubFn<typeof state.epochCtx["getBeaconProposer"]>).withArgs(
        signedBlock.message.slot
      ).calledOnce
    ).to.be.true;
  });
});
