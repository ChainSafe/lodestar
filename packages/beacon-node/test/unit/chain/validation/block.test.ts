import {Mock, Mocked, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, ForkPostDeneb, ForkPreFulu} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {SignedBeaconBlock, deneb, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {QueuedStateRegenerator} from "../../../../src/chain/regen/index.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/index.js";
import {validateGossipBlock} from "../../../../src/chain/validation/index.js";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../../../src/constants/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateCachedState} from "../../../utils/state.js";

describe("gossip block validation", () => {
  let chain: MockedBeaconChain;
  let forkChoice: MockedBeaconChain["forkChoice"];
  let regen: Mocked<QueuedStateRegenerator>;
  let verifySignature: Mock<() => boolean>;
  let job: deneb.SignedBeaconBlock;
  const proposerIndex = 0;
  const clockSlot = 32;
  const block = ssz.deneb.BeaconBlock.defaultValue();
  block.slot = clockSlot;
  const signature = EMPTY_SIGNATURE;
  const denebConfig = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
  });
  const config = createBeaconConfig(configDef, Buffer.alloc(32, 0xaa));
  const gloasConfig = createBeaconConfig(
    {
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    },
    Buffer.alloc(32, 0xaa)
  );

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    vi.spyOn(chain.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(clockSlot);
    forkChoice = chain.forkChoice;
    forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
    chain.forkChoice = forkChoice;
    regen = chain.regen;

    (chain as any).opts = {};

    verifySignature = chain.bls.verifySignatureSets;
    verifySignature.mockResolvedValue(true);
    forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: ZERO_HASH,
      rootHex: "",
    });

    // Reset seen cache
    (
      chain as {
        seenBlockProposers: SeenBlockProposers;
      }
    ).seenBlockProposers = new SeenBlockProposers();

    job = {signature, message: block};
  });

  it("FUTURE_SLOT", async () => {
    // Set the block slot to after the current clock
    const signedBlock = {signature, message: {...block, slot: clockSlot + 1}};

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, signedBlock, ForkName.phase0),
      BlockErrorCode.FUTURE_SLOT
    );
  });

  it("WOULD_REVERT_FINALIZED_SLOT", async () => {
    // Set finalized epoch to be greater than block's epoch
    forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: Infinity,
      root: ZERO_HASH,
      rootHex: "",
    });

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT
    );
  });

  it("ALREADY_KNOWN", async () => {
    // Make the fork choice return a block summary for the proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValue({} as ProtoBlock);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.ALREADY_KNOWN
    );
  });

  it("pre-Gloas REPEAT_PROPOSAL records a conflicting root after verifying its proposer signature", async () => {
    const blockRoot = toRootHex(config.getForkTypes(job.message.slot).BeaconBlock.hashTreeRoot(job.message));
    chain.seenBlockProposers.observeBlockRoot(job.message.slot, job.message.proposerIndex, blockRoot);
    chain.seenBlockProposers.add(job.message.slot, job.message.proposerIndex);

    const conflictingBlock = ssz.deneb.SignedBeaconBlock.clone(job);
    conflictingBlock.message.stateRoot = Buffer.alloc(32, 1);
    const conflictingBlockRoot = toRootHex(
      config.getForkTypes(conflictingBlock.message.slot).BeaconBlock.hashTreeRoot(conflictingBlock.message)
    );

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, conflictingBlock, ForkName.phase0),
      BlockErrorCode.REPEAT_PROPOSAL
    );

    expect(verifySignature).toHaveBeenCalledOnce();
    expect(chain.seenBlockProposers.getConflictingBlockRoots(clockSlot, proposerIndex, blockRoot)).toEqual([
      conflictingBlockRoot,
    ]);
  });

  it("Gloas REPEAT_PROPOSAL records a conflicting root after verifying its proposer signature", async () => {
    Object.defineProperty(chain, "config", {value: gloasConfig});
    const gloasBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
    gloasBlock.message.slot = clockSlot;
    gloasBlock.message.proposerIndex = proposerIndex;
    const blockRoot = toRootHex(gloasConfig.getForkTypes(clockSlot).BeaconBlock.hashTreeRoot(gloasBlock.message));
    chain.seenBlockProposers.observeBlockRoot(clockSlot, proposerIndex, blockRoot);
    chain.seenBlockProposers.add(clockSlot, proposerIndex);

    const conflictingBlock = ssz.gloas.SignedBeaconBlock.clone(gloasBlock);
    conflictingBlock.message.stateRoot = Buffer.alloc(32, 1);
    const conflictingBlockRoot = toRootHex(
      gloasConfig.getForkTypes(conflictingBlock.message.slot).BeaconBlock.hashTreeRoot(conflictingBlock.message)
    );

    await expectRejectedWithLodestarError(
      validateGossipBlock(gloasConfig, chain, conflictingBlock, ForkName.gloas),
      BlockErrorCode.REPEAT_PROPOSAL
    );

    expect(verifySignature).toHaveBeenCalledOnce();
    expect(chain.seenBlockProposers.getConflictingBlockRoots(clockSlot, proposerIndex, blockRoot)).toEqual([
      conflictingBlockRoot,
    ]);
  });

  it("does not record a Gloas conflicting root with an invalid proposer signature", async () => {
    Object.defineProperty(chain, "config", {value: gloasConfig});
    const gloasBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
    gloasBlock.message.slot = clockSlot;
    gloasBlock.message.proposerIndex = proposerIndex;
    const blockRoot = toRootHex(gloasConfig.getForkTypes(clockSlot).BeaconBlock.hashTreeRoot(gloasBlock.message));
    chain.seenBlockProposers.observeBlockRoot(clockSlot, proposerIndex, blockRoot);
    chain.seenBlockProposers.add(clockSlot, proposerIndex);

    const conflictingBlock = ssz.gloas.SignedBeaconBlock.clone(gloasBlock);
    conflictingBlock.message.stateRoot = Buffer.alloc(32, 1);
    verifySignature.mockResolvedValue(false);

    await expectRejectedWithLodestarError(
      validateGossipBlock(gloasConfig, chain, conflictingBlock, ForkName.gloas),
      BlockErrorCode.PROPOSAL_SIGNATURE_INVALID
    );

    expect(chain.seenBlockProposers.getConflictingBlockRoots(clockSlot, proposerIndex, blockRoot)).toEqual([]);
  });

  it("PARENT_BLOCK_UNKNOWN (fork-choice)", async () => {
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Return not known for parent block too
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PARENT_BLOCK_UNKNOWN
    );
  });

  it("NOT_LATER_THAN_PARENT", async () => {
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot + 1} as ProtoBlock);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.NOT_LATER_THAN_PARENT
    );
  });

  it("PARENT_BLOCK_UNKNOWN (regen)", async () => {
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen not able to get the parent block state
    regen.getPreState.mockRejectedValue(undefined);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PARENT_BLOCK_UNKNOWN
    );
  });

  it("PROPOSAL_SIGNATURE_INVALID", async () => {
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    regen.getPreState.mockResolvedValue(new BeaconStateView(generateCachedState()));
    // BLS signature verifier returns invalid
    verifySignature.mockResolvedValue(false);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.PROPOSAL_SIGNATURE_INVALID
    );
  });

  it("INCORRECT_PROPOSER", async () => {
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    const state = new BeaconStateView(generateCachedState());
    regen.getPreState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return wrong value
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex + 1);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.INCORRECT_PROPOSER
    );
  });

  it("valid", async () => {
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    const state = new BeaconStateView(generateCachedState());
    regen.getPreState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return correct value
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);

    await validateGossipBlock(config, chain, job, ForkName.phase0);
  });

  it("deneb - TOO_MANY_KZG_COMMITMENTS", async () => {
    // Fill up with kzg commitments
    block.body.blobKzgCommitments = Array.from(
      {length: denebConfig.getMaxBlobsPerBlock(denebConfig.DENEB_FORK_EPOCH)},
      () => new Uint8Array([0])
    );
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    const state = new BeaconStateView(generateCachedState());
    regen.getPreState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return correct value
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex + 1);
    // Add one extra kzg commitment in the block so it goes over the limit
    (job as SignedBeaconBlock<ForkPostDeneb & ForkPreFulu>).message.body.blobKzgCommitments.push(new Uint8Array([0]));

    await expectRejectedWithLodestarError(
      validateGossipBlock(denebConfig, chain, job, ForkName.deneb),
      BlockErrorCode.TOO_MANY_KZG_COMMITMENTS
    );
  });

  it("deneb - valid", async () => {
    // Fill up with kzg commitments
    block.body.blobKzgCommitments = Array.from(
      {length: denebConfig.getMaxBlobsPerBlock(denebConfig.DENEB_FORK_EPOCH)},
      () => new Uint8Array([0])
    );
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Returned parent block is latter than proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns some state
    const state = new BeaconStateView(generateCachedState());
    regen.getPreState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return correct value
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);
    // Keep number of kzg commitments as is so it stays within the limit

    await validateGossipBlock(denebConfig, chain, job, ForkName.deneb);
  });
});
