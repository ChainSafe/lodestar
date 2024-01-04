import {Mock, MockedObject, beforeEach, describe, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {allForks, ssz} from "@lodestar/types";
import {BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {QueuedStateRegenerator} from "../../../../src/chain/regen/index.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/index.js";
import {validateGossipBlock} from "../../../../src/chain/validation/index.js";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../../../src/constants/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../__mocks__/mockedBeaconChain.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateCachedState} from "../../../utils/state.js";

describe("gossip block validation", function () {
  let chain: MockedBeaconChain;
  let forkChoice: MockedBeaconChain["forkChoice"];
  let regen: MockedObject<QueuedStateRegenerator>;
  let verifySignature: Mock<[boolean]>;
  let job: allForks.SignedBeaconBlock;
  const proposerIndex = 0;
  const clockSlot = 32;
  const block = ssz.phase0.BeaconBlock.defaultValue();
  block.slot = clockSlot;
  const signature = EMPTY_SIGNATURE;
  const maxSkipSlots = 10;

  beforeEach(function () {
    chain = getMockedBeaconChain();
    vi.spyOn(chain.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(clockSlot);
    forkChoice = chain.forkChoice;
    forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice = forkChoice;
    regen = chain.regen;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (chain as any).opts = {maxSkipSlots};

    verifySignature = chain.bls.verifySignatureSets;
    verifySignature.mockResolvedValue(true);
    forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: ZERO_HASH, rootHex: ""});

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
    forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: Infinity, root: ZERO_HASH, rootHex: ""});

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT
    );
  });

  it("ALREADY_KNOWN", async function () {
    // Make the fork choice return a block summary for the proposed block
    forkChoice.getBlockHex.mockReturnValue({} as ProtoBlock);

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
    forkChoice.getBlockHex.mockReturnValueOnce(null);
    // Return not known for parent block too
    forkChoice.getBlockHex.mockReturnValueOnce(null);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PARENT_UNKNOWN
    );
  });

  it("TOO_MANY_SKIPPED_SLOTS", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.mockReturnValueOnce(null);
    // Return parent block with 1 slot way back than maxSkipSlots
    forkChoice.getBlockHex.mockReturnValueOnce({slot: block.slot - (maxSkipSlots + 1)} as ProtoBlock);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.TOO_MANY_SKIPPED_SLOTS
    );
  });

  it("NOT_LATER_THAN_PARENT", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.mockReturnValueOnce({slot: clockSlot + 1} as ProtoBlock);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.NOT_LATER_THAN_PARENT
    );
  });

  it("PARENT_UNKNOWN (regen)", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen not able to get the parent block state
    regen.getPreState.mockRejectedValue(undefined);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PARENT_UNKNOWN
    );
  });

  it("PROPOSAL_SIGNATURE_INVALID", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    regen.getPreState.mockResolvedValue(generateCachedState());
    // BLS signature verifier returns invalid
    verifySignature.mockResolvedValue(false);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PROPOSAL_SIGNATURE_INVALID
    );
  });

  it("INCORRECT_PROPOSER", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    const state = generateCachedState();
    regen.getPreState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return wrong value
    vi.spyOn(state.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex + 1);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.INCORRECT_PROPOSER
    );
  });

  it("valid", async function () {
    // Return not known for proposed block
    forkChoice.getBlockHex.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHex.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    const state = generateCachedState();
    regen.getPreState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return wrong value
    vi.spyOn(state.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);

    await validateGossipBlock(config, chain, job, ForkName.phase0);
  });
});
