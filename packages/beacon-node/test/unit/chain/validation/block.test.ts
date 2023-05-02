import sinon, {SinonStubbedInstance} from "sinon";
import {config} from "@lodestar/config/default";
import {ForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {allForks, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {BeaconChain} from "../../../../src/chain/index.js";
import {Clock} from "../../../../src/util/clock.js";
import {StateRegenerator} from "../../../../src/chain/regen/index.js";
import {validateGossipBlock} from "../../../../src/chain/validation/index.js";
import {generateCachedState} from "../../../utils/state.js";
import {BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {SinonStubFn} from "../../../utils/types.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/index.js";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../../../src/constants/index.js";
import {StubbedChainMutable} from "../../../utils/stub/index.js";

type StubbedChain = StubbedChainMutable<"clock" | "forkChoice" | "regen" | "bls">;

describe("gossip block validation", function () {
  let chain: StubbedChain;
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let regen: SinonStubbedInstance<StateRegenerator>;
  let verifySignature: SinonStubFn<() => Promise<boolean>>;
  let job: allForks.SignedBeaconBlock;
  const proposerIndex = 0;
  const clockSlot = 32;
  const block = ssz.phase0.BeaconBlock.defaultValue();
  block.slot = clockSlot;
  const signature = EMPTY_SIGNATURE;
  const maxSkipSlots = 10;

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    chain.clock = sinon.createStubInstance(Clock);
    sinon.stub(chain.clock, "currentSlotWithGossipDisparity").get(() => clockSlot);
    forkChoice = sinon.createStubInstance(ForkChoice);
    forkChoice.getBlockHex.returns(null);
    chain.forkChoice = forkChoice;
    regen = chain.regen = sinon.createStubInstance(StateRegenerator);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (chain as any).opts = {maxSkipSlots};

    verifySignature = sinon.stub();
    verifySignature.resolves(true);
    chain.bls = {verifySignatureSets: verifySignature, close: () => Promise.resolve(), canAcceptWork: () => true};

    forkChoice.getFinalizedCheckpoint.returns({epoch: 0, root: ZERO_HASH, rootHex: ""});

    // Reset seen cache
    (
      chain as {
        seenBlockProposers: SeenBlockProposers;
      }
    ).seenBlockProposers = new SeenBlockProposers();

    job = {signature, message: block};
  });

  it("FUTURE_SLOT", async function () {
    // Set the block slot to after the current clock
    const signedBlock = {signature, message: {...block, slot: clockSlot + 1}};

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, signedBlock, ForkName.phase0),
      BlockErrorCode.FUTURE_SLOT
    );
  });

  it("WOULD_REVERT_FINALIZED_SLOT", async function () {
    // Set finalized epoch to be greater than block's epoch
    forkChoice.getFinalizedCheckpoint.returns({epoch: Infinity, root: ZERO_HASH, rootHex: ""});

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT
    );
  });

  it("ALREADY_KNOWN", async function () {
    // Make the fork choice return a block summary for the proposed block
    forkChoice.getBlockHex.returns({} as ProtoBlock);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.ALREADY_KNOWN
    );
  });

  it("REPEAT_PROPOSAL", async function () {
    // Register the proposer as known
    chain.seenBlockProposers.add(job.message.slot, job.message.proposerIndex);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.REPEAT_PROPOSAL
    );
  });

  it("PARENT_UNKNOWN (fork-choice)", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.onCall(0).returns(null);
    // Return not known for parent block too
    forkChoice.getBlockHex.onCall(1).returns(null);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PARENT_UNKNOWN
    );
  });

  it("TOO_MANY_SKIPPED_SLOTS", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.onCall(0).returns(null);
    // Return parent block with 1 slot way back than maxSkipSlots
    forkChoice.getBlockHex.onCall(1).returns({slot: block.slot - (maxSkipSlots + 1)} as ProtoBlock);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.TOO_MANY_SKIPPED_SLOTS
    );
  });

  it("NOT_LATER_THAN_PARENT", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.onCall(0).returns(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.onCall(1).returns({slot: clockSlot + 1} as ProtoBlock);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.NOT_LATER_THAN_PARENT
    );
  });

  it("PARENT_UNKNOWN (regen)", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.onCall(0).returns(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.onCall(1).returns({slot: clockSlot - 1} as ProtoBlock);
    // Regen not able to get the parent block state
    regen.getBlockSlotState.rejects();

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PARENT_UNKNOWN
    );
  });

  it("PROPOSAL_SIGNATURE_INVALID", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.onCall(0).returns(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.onCall(1).returns({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    regen.getBlockSlotState.resolves(generateCachedState());
    // BLS signature verifier returns invalid
    verifySignature.resolves(false);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PROPOSAL_SIGNATURE_INVALID
    );
  });

  it("INCORRECT_PROPOSER", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.onCall(0).returns(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.onCall(1).returns({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    const state = generateCachedState();
    regen.getBlockSlotState.resolves(state);
    // BLS signature verifier returns valid
    verifySignature.resolves(true);
    // Force proposer shuffling cache to return wrong value
    sinon.stub(state.epochCtx, "getBeaconProposer").returns(proposerIndex + 1);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.INCORRECT_PROPOSER
    );
  });

  it("valid", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.onCall(0).returns(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.onCall(1).returns({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    const state = generateCachedState();
    regen.getBlockSlotState.resolves(state);
    // BLS signature verifier returns valid
    verifySignature.resolves(true);
    // Force proposer shuffling cache to return wrong value
    sinon.stub(state.epochCtx, "getBeaconProposer").returns(proposerIndex);

    await validateGossipBlock(config, chain, job, ForkName.phase0);
  });
});
