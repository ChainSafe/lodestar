import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {config} from "@chainsafe/lodestar-config/default";
import {BeaconChain, ForkChoice, IBeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock";
import {StateRegenerator} from "../../../../src/chain/regen";
import {validateGossipBlock} from "../../../../src/chain/validation";
import {generateSignedBlock, getNewBlockJob} from "../../../utils/block";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {BlockErrorCode} from "../../../../src/chain/errors";
import {SinonStubFn} from "../../../utils/types";
import {expectRejectedWithLodestarError} from "../../../utils/errors";

describe("gossip block validation", function () {
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let regenStub: SinonStubbedInstance<StateRegenerator>;
  let dbStub: StubbedBeaconDb;
  let verifySignatureStub: SinonStubFn<() => Promise<boolean>>;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.clock = sinon.createStubInstance(LocalClock);
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    chainStub.forkChoice = forkChoiceStub;
    regenStub = chainStub.regen = sinon.createStubInstance(StateRegenerator);
    dbStub = new StubbedBeaconDb(sinon, config);

    verifySignatureStub = sinon.stub();
    verifySignatureStub.resolves(true);
    chainStub.bls = {verifySignatureSets: verifySignatureStub};
  });

  it("should throw error - block slot is finalized", async function () {
    const signedBlock = generateSignedBlock();
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.returns({
      epoch: 1,
      root: Buffer.alloc(32),
    });

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chainStub, dbStub, job),
      BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT
    );

    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(chainStub.getGenesisTime.notCalled).to.be.true;
  });

  it("should throw error - already proposed", async function () {
    sinon.stub(chainStub.clock, "currentSlotWithGossipDisparity").get(() => 1);
    const signedBlock = generateSignedBlock({message: {slot: 1}});
    const job = getNewBlockJob(signedBlock);
    chainStub.getFinalizedCheckpoint.returns({
      epoch: 0,
      root: Buffer.alloc(32),
    });
    dbStub.block.get.resolves(generateSignedBlock({message: {proposerIndex: signedBlock.message.proposerIndex}}));

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chainStub, dbStub, job),
      BlockErrorCode.REPEAT_PROPOSAL
    );

    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
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
    regenStub.getBlockSlotState.rejects();

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chainStub, dbStub, job),
      BlockErrorCode.PARENT_UNKNOWN
    );

    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
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
    regenStub.getBlockSlotState.resolves(generateCachedState());
    verifySignatureStub.resolves(false);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chainStub, dbStub, job),
      BlockErrorCode.PROPOSAL_SIGNATURE_INVALID
    );

    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
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
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getBeaconProposer").returns(signedBlock.message.proposerIndex + 1);
    regenStub.getBlockSlotState.resolves(state);
    verifySignatureStub.resolves(true);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chainStub, dbStub, job),
      BlockErrorCode.INCORRECT_PROPOSER
    );

    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
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
    chainStub.getCanonicalBlockAtSlot.resolves(null);
    forkChoiceStub.isDescendantOfFinalized.returns(true);
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getBeaconProposer").returns(signedBlock.message.proposerIndex);
    regenStub.getBlockSlotState.resolves(state);
    verifySignatureStub.resolves(true);
    forkChoiceStub.getAncestor.resolves(Buffer.alloc(32));
    const validationTest = await validateGossipBlock(config, chainStub, dbStub, job);
    expect(validationTest).to.not.throw;
    expect(chainStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(verifySignatureStub.calledOnce).to.be.true;
    expect(
      (state.epochCtx.getBeaconProposer as SinonStubFn<typeof state.epochCtx["getBeaconProposer"]>).withArgs(
        signedBlock.message.slot
      ).calledOnce
    ).to.be.true;
  });
});
