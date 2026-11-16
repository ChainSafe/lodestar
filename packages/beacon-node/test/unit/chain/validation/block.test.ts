import {Mock, Mocked, beforeEach, describe, expect, it, vi} from "vitest";
import {BeaconConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus, ParentPayloadDependency, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, ForkPostDeneb, ForkPreFulu, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockErrorCode, GossipAction} from "../../../../src/chain/errors/index.js";
import {QueuedStateRegenerator} from "../../../../src/chain/regen/index.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/index.js";
import {validateGossipBlock} from "../../../../src/chain/validation/index.js";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../../../src/constants/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateCachedElectraState, generateCachedState} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";
import {
  UnfinalizedForkChoice,
  generateGloasBlockOnParent,
  initForkChoiceFromUnfinalizedGloasState,
} from "../../../utils/unfinalizedForkChoice.js";

describe("gossip block validation", () => {
  let chain: MockedBeaconChain;
  let forkChoice: MockedBeaconChain["forkChoice"];
  let regen: Mocked<QueuedStateRegenerator>;
  let verifySignature: Mock<() => boolean>;
  let job: SignedBeaconBlock;
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

  function setupChain(chainConfig = config, genesisTime = 0): void {
    chain = getMockedBeaconChain({config: chainConfig, genesisTime});
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
  }

  beforeEach(() => {
    setupChain();
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

  describe("repeat proposal handling", () => {
    beforeEach(() => {
      setupChain(gloasConfig);
    });

    it("ignores a same-root duplicate as ALREADY_KNOWN, not REPEAT_PROPOSAL", async () => {
      const forkTypes = gloasConfig.getForkTypes(clockSlot);
      const signedBlock = forkTypes.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = clockSlot;
      signedBlock.message.proposerIndex = proposerIndex;
      const blockRoot = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
      chain.seenBlockProposers.observeBlockRoot(
        clockSlot,
        proposerIndex,
        blockRoot,
        signedBlockToSignedHeader(gloasConfig, signedBlock)
      );
      chain.seenBlockProposers.add(clockSlot, proposerIndex, blockRoot);

      // Re-submitting the SAME block (same root) is a benign duplicate, not an equivocation
      await expectRejectedWithLodestarError(
        validateGossipBlock(gloasConfig, chain, signedBlock, ForkName.gloas),
        BlockErrorCode.ALREADY_KNOWN
      );
    });

    it("records a conflicting block root after verifying the proposer signature", async () => {
      const forkTypes = gloasConfig.getForkTypes(clockSlot);
      const signedBlock = forkTypes.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = clockSlot;
      signedBlock.message.proposerIndex = proposerIndex;
      const blockRoot = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
      chain.seenBlockProposers.observeBlockRoot(
        clockSlot,
        proposerIndex,
        blockRoot,
        signedBlockToSignedHeader(gloasConfig, signedBlock)
      );
      chain.seenBlockProposers.add(clockSlot, proposerIndex, blockRoot);

      const conflictingBlock = forkTypes.SignedBeaconBlock.clone(signedBlock);
      conflictingBlock.message.stateRoot = Buffer.alloc(32, 1);
      const conflictingBlockRoot = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(conflictingBlock.message));

      await expectRejectedWithLodestarError(
        validateGossipBlock(gloasConfig, chain, conflictingBlock, ForkName.gloas),
        BlockErrorCode.REPEAT_PROPOSAL
      );

      expect(verifySignature).toHaveBeenCalledOnce();
      expect(verifySignature).toHaveBeenCalledWith(expect.any(Array), {verifyOnMainThread: false});
      expect(chain.seenBlockProposers.getConflictingBlockRoots(clockSlot, proposerIndex, blockRoot)).toEqual([
        conflictingBlockRoot,
      ]);
      const equivocationHeaders = chain.seenBlockProposers.getEquivocationHeaders(clockSlot, proposerIndex);
      expect(
        equivocationHeaders?.map((header) => toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(header.message)))
      ).toEqual([blockRoot, conflictingBlockRoot]);
    });

    it("does not record a conflicting block root when the proposer signature is invalid", async () => {
      const forkTypes = gloasConfig.getForkTypes(clockSlot);
      const signedBlock = forkTypes.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = clockSlot;
      signedBlock.message.proposerIndex = proposerIndex;
      const blockRoot = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
      chain.seenBlockProposers.observeBlockRoot(
        clockSlot,
        proposerIndex,
        blockRoot,
        signedBlockToSignedHeader(gloasConfig, signedBlock)
      );
      chain.seenBlockProposers.add(clockSlot, proposerIndex, blockRoot);

      const conflictingBlock = forkTypes.SignedBeaconBlock.clone(signedBlock);
      conflictingBlock.message.stateRoot = Buffer.alloc(32, 1);
      verifySignature.mockResolvedValue(false);

      await expectRejectedWithLodestarError(
        validateGossipBlock(gloasConfig, chain, conflictingBlock, ForkName.gloas),
        BlockErrorCode.PROPOSAL_SIGNATURE_INVALID
      );

      expect(chain.seenBlockProposers.getConflictingBlockRoots(clockSlot, proposerIndex, blockRoot)).toEqual([]);
    });

    it("skips proposer signature verification after observing an equivocation", async () => {
      const forkTypes = gloasConfig.getForkTypes(clockSlot);
      const signedBlock = forkTypes.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = clockSlot;
      signedBlock.message.proposerIndex = proposerIndex;
      const blockRoot = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
      chain.seenBlockProposers.observeBlockRoot(
        clockSlot,
        proposerIndex,
        blockRoot,
        signedBlockToSignedHeader(gloasConfig, signedBlock)
      );
      chain.seenBlockProposers.observeBlockRoot(
        clockSlot,
        proposerIndex,
        toRootHex(Buffer.alloc(32, 1)),
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );
      chain.seenBlockProposers.add(clockSlot, proposerIndex, blockRoot);

      const additionalBlock = forkTypes.SignedBeaconBlock.clone(signedBlock);
      additionalBlock.message.stateRoot = Buffer.alloc(32, 2);

      await expectRejectedWithLodestarError(
        validateGossipBlock(gloasConfig, chain, additionalBlock, ForkName.gloas),
        BlockErrorCode.REPEAT_PROPOSAL
      );

      expect(verifySignature).not.toHaveBeenCalled();
    });

    it("detects another proposal that becomes known during the early-block delay", async () => {
      const now = 1_000_000;
      vi.useFakeTimers({now});

      try {
        const genesisTime = now / 1000 - clockSlot * (gloasConfig.SLOT_DURATION_MS / 1000) + 0.1;
        setupChain(gloasConfig, genesisTime);
        const forkTypes = gloasConfig.getForkTypes(clockSlot);
        const signedBlock = forkTypes.SignedBeaconBlock.defaultValue();
        signedBlock.message.slot = clockSlot;
        signedBlock.message.proposerIndex = proposerIndex;
        forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
        // A pre-gloas parent, the bid of the block builds on its payload: the latest payload of the parent's
        // post-state, which has the default header
        const parentPayloadRoot = ssz.electra.ExecutionPayloadHeader.hashTreeRoot(
          ssz.electra.ExecutionPayloadHeader.defaultValue()
        );
        (
          signedBlock as SignedBeaconBlock<ForkName.gloas>
        ).message.body.signedExecutionPayloadBid.message.parentPayloadRoot = parentPayloadRoot;
        const parentBlock = generateProtoBlock({
          slot: clockSlot - 1,
          executionPayloadBlockHash: toRootHex(ZERO_HASH),
          executionPayloadRoot: toRootHex(parentPayloadRoot),
          executionPayloadNumber: 0,
          executionPayloadGasLimit: 0,
          executionStatus: ExecutionStatus.Valid,
        });
        forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(parentBlock);
        forkChoice.getParentPayloadDependency.mockReturnValue(ParentPayloadDependency.Ready);
        const state = new BeaconStateView(generateCachedElectraState());
        regen.getState.mockResolvedValue(state);
        vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);

        const validation = expectRejectedWithLodestarError(
          validateGossipBlock(gloasConfig, chain, signedBlock, ForkName.gloas),
          BlockErrorCode.REPEAT_PROPOSAL
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(1);

        // A different proposal (different root) becomes known during the delay -> genuine repeat proposal
        chain.seenBlockProposers.add(clockSlot, proposerIndex, toRootHex(Buffer.alloc(32, 0xff)));
        await vi.advanceTimersByTimeAsync(100);
        await validation;
      } finally {
        vi.useRealTimers();
      }
    });
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
    // Regen not able to get the parent block state (fast path getState, then getPreState fallback)
    regen.getState.mockRejectedValue(undefined);
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
    regen.getState.mockResolvedValue(new BeaconStateView(generateCachedState()));
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
    regen.getState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return wrong value
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex + 1);

    await expectRejectedWithLodestarError(
      validateGossipBlock(config, chain, job, ForkName.phase0),
      BlockErrorCode.INCORRECT_PROPOSER
    );
  });

  it("valid - uses parent state (fast path), no epoch transition", async () => {
    // Return not known for proposed block
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    // Returned parent block is one epoch behind the proposed block (within proposer-lookahead range)
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    // Regen returns the parent state directly, no dial-forward
    const state = new BeaconStateView(generateCachedState());
    regen.getState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return correct value
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);

    await validateGossipBlock(config, chain, job, ForkName.phase0);

    expect(regen.getState).toHaveBeenCalledOnce();
    expect(regen.getPreState).not.toHaveBeenCalled();
  });

  it("valid - falls back to getPreState when parent state not in memory", async () => {
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: clockSlot - 1} as ProtoBlock);
    const state = new BeaconStateView(generateCachedState());
    // Fast path miss: parent state not in memory, then getPreState resolves (disk reload / dial-forward)
    regen.getState.mockRejectedValue(undefined);
    regen.getPreState.mockResolvedValue(state);
    verifySignature.mockResolvedValue(true);
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);

    await validateGossipBlock(config, chain, job, ForkName.phase0);

    expect(regen.getState).toHaveBeenCalledOnce();
    expect(regen.getPreState).toHaveBeenCalledOnce();
  });

  it("valid - deep skip uses getPreState (parent more than 1 epoch behind)", async () => {
    // Block is in epoch 2, parent in epoch 0 -> beyond proposer-lookahead range
    const deepClockSlot = 2 * SLOTS_PER_EPOCH;
    vi.spyOn(chain.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(deepClockSlot);
    const deepBlock = ssz.deneb.BeaconBlock.defaultValue();
    deepBlock.slot = deepClockSlot;
    deepBlock.proposerIndex = proposerIndex;
    const deepJob: SignedBeaconBlock = {signature, message: deepBlock};

    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
    forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    const state = new BeaconStateView(generateCachedState());
    regen.getPreState.mockResolvedValue(state);
    verifySignature.mockResolvedValue(true);
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);

    await validateGossipBlock(config, chain, deepJob, ForkName.phase0);

    expect(regen.getPreState).toHaveBeenCalledOnce();
    expect(regen.getState).not.toHaveBeenCalled();
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
    regen.getState.mockResolvedValue(state);
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
    regen.getState.mockResolvedValue(state);
    // BLS signature verifier returns valid
    verifySignature.mockResolvedValue(true);
    // Force proposer shuffling cache to return correct value
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);
    // Keep number of kzg commitments as is so it stays within the limit

    await validateGossipBlock(denebConfig, chain, job, ForkName.deneb);
  });
  describe("gloas - bid builds on the parent's execution head", () => {
    const parentBlockHash = Buffer.alloc(32, 0x11);
    const otherRoot = Buffer.alloc(32, 0x33);
    // The first gloas block, its pre-state is the pre-gloas post-state of its parent
    const firstGloasBlockConfig = createBeaconConfig(
      {...gloasConfig, GLOAS_FORK_EPOCH: 1},
      gloasConfig.genesisValidatorsRoot
    );
    const parentPayloadHeader = ssz.electra.ExecutionPayloadHeader.defaultValue();
    parentPayloadHeader.blockHash = parentBlockHash;
    // The root of a payload equals the root of its header
    const parentPayloadRoot = ssz.electra.ExecutionPayloadHeader.hashTreeRoot(parentPayloadHeader);
    let gloasJob: SignedBeaconBlock<ForkName.gloas>;

    /**
     * `state` is the pre-gloas post-state of the parent, as returned by regen for the first gloas block. Its
     * latest payload is the one of the parent, with block hash `parentBlockHash` and root `parentPayloadRoot`
     */
    function setup(
      parentBlock: ProtoBlock,
      parentPayloadDependency: ParentPayloadDependency,
      bid: {parentBlockHash: Uint8Array; parentPayloadRoot: Uint8Array}
    ): void {
      setupChain(firstGloasBlockConfig);
      const gloasBlock = ssz.gloas.BeaconBlock.defaultValue();
      gloasBlock.slot = clockSlot;
      gloasBlock.proposerIndex = proposerIndex;
      gloasBlock.body.signedExecutionPayloadBid.message.parentBlockHash = bid.parentBlockHash;
      gloasBlock.body.signedExecutionPayloadBid.message.parentPayloadRoot = bid.parentPayloadRoot;
      gloasJob = {signature, message: gloasBlock};

      forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(null);
      forkChoice.getBlockHexDefaultStatus.mockReturnValueOnce(parentBlock);
      forkChoice.getParentPayloadDependency.mockReturnValue(parentPayloadDependency);
      const cachedState = generateCachedElectraState();
      cachedState.latestExecutionPayloadHeader = ssz.electra.ExecutionPayloadHeader.toViewDU(parentPayloadHeader);
      cachedState.commit();
      const state = new BeaconStateView(cachedState);
      regen.getState.mockResolvedValue(state);
      vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);
    }

    function preGloasParent(overrides: Partial<ProtoBlock> = {}): ProtoBlock {
      return generateProtoBlock({
        slot: clockSlot - 1,
        executionPayloadBlockHash: toRootHex(parentBlockHash),
        executionPayloadRoot: toRootHex(parentPayloadRoot),
        executionPayloadNumber: 1,
        executionPayloadGasLimit: 30_000_000,
        executionStatus: ExecutionStatus.Valid,
        ...overrides,
      } as Partial<ProtoBlock>);
    }

    it("valid - first gloas block builds on the payload of its pre-gloas parent", async () => {
      setup(preGloasParent(), ParentPayloadDependency.Ready, {parentBlockHash, parentPayloadRoot});

      await validateGossipBlock(firstGloasBlockConfig, chain, gloasJob, ForkName.gloas);
    });

    it("BID_PARENT_PAYLOAD_MISMATCH - first gloas block names another parent payload root", async () => {
      // Fork choice does not resolve the root to the pre-gloas parent, which has no payload to wait for
      setup(preGloasParent(), ParentPayloadDependency.Invalid, {parentBlockHash, parentPayloadRoot: otherRoot});

      await expectRejectedWithLodestarError(
        validateGossipBlock(firstGloasBlockConfig, chain, gloasJob, ForkName.gloas),
        BlockErrorCode.BID_PARENT_PAYLOAD_MISMATCH
      );
    });

    it("BID_PARENT_PAYLOAD_MISMATCH - first gloas block names another parent block hash", async () => {
      setup(preGloasParent(), ParentPayloadDependency.Ready, {parentBlockHash: otherRoot, parentPayloadRoot});

      await expectRejectedWithLodestarError(
        validateGossipBlock(firstGloasBlockConfig, chain, gloasJob, ForkName.gloas),
        BlockErrorCode.BID_PARENT_PAYLOAD_MISMATCH
      );
    });

    it("valid - the bid is checked against the state, not the fields of a placeholder parent", async () => {
      // After a start from an unfinalized state the ancestors of the anchor carry the execution payload fields
      // of the anchor. A block that builds on the real payload of such a parent must not be rejected for it
      const placeholder = preGloasParent({
        isPlaceholder: true,
        executionPayloadBlockHash: toRootHex(otherRoot),
        executionPayloadRoot: toRootHex(otherRoot),
      });
      setup(placeholder, ParentPayloadDependency.Ready, {parentBlockHash, parentPayloadRoot});

      await validateGossipBlock(firstGloasBlockConfig, chain, gloasJob, ForkName.gloas);
    });

    it("PARENT_PAYLOAD_UNKNOWN - the payload of the gloas parent is not imported", async () => {
      const parentBlock = generateProtoBlock({
        slot: clockSlot - 1,
        executionPayloadBlockHash: toRootHex(otherRoot),
        executionPayloadRoot: toRootHex(otherRoot),
        executionPayloadNumber: 1,
        executionPayloadGasLimit: 30_000_000,
        executionStatus: ExecutionStatus.Valid,
        payloadStatus: PayloadStatus.PENDING,
        parentBlockHash: toRootHex(otherRoot),
        parentPayloadRoot: toRootHex(otherRoot),
        payloadRoot: toRootHex(parentPayloadRoot),
      });
      setup(parentBlock, ParentPayloadDependency.AwaitingPayload, {parentBlockHash, parentPayloadRoot});

      await expectRejectedWithLodestarError(
        validateGossipBlock(firstGloasBlockConfig, chain, gloasJob, ForkName.gloas),
        BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
      );
      expect(forkChoice.getParentPayloadDependency).toHaveBeenCalledWith(
        toRootHex(gloasJob.message.parentRoot),
        toRootHex(parentPayloadRoot)
      );
    });

    describe("after a restart from an unfinalized state", () => {
      // The real fork choice of a restarted node: the ancestors of the head are placeholders that carry the bid
      // fields of the head, not those of their blocks
      async function setupRestarted(
        getBlock: (restarted: UnfinalizedForkChoice) => SignedBeaconBlock<ForkName.gloas>
      ): Promise<UnfinalizedForkChoice> {
        const restarted = await initForkChoiceFromUnfinalizedGloasState();
        setupChain(restarted.config as BeaconConfig);
        gloasJob = getBlock(restarted);
        vi.spyOn(chain.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(gloasJob.message.slot);
        chain.forkChoice = restarted.forkChoice as unknown as MockedBeaconChain["forkChoice"];
        return restarted;
      }

      it.each(["parentRoot", "justifiedRoot", "finalizedRoot"] as const)(
        "PARENT_PAYLOAD_UNKNOWN - a block that forks off the placeholder %s waits for the payload",
        async (ancestor) => {
          // A valid child of the real ancestor block names the payload of that block, which is neither the
          // `payloadRoot` nor the `parentPayloadRoot` of the placeholder
          const restarted = await setupRestarted((restarted) =>
            generateGloasBlockOnParent(restarted.headSlot, restarted[ancestor], Buffer.alloc(32, 0x3a))
          );

          const promise = validateGossipBlock(restarted.config, chain, gloasJob, ForkName.gloas);
          await expectRejectedWithLodestarError(promise, BlockErrorCode.PARENT_PAYLOAD_UNKNOWN);
          await expect(promise).rejects.toHaveProperty("action", GossipAction.IGNORE);
          // The same verdict as BlockInputSync and the network processor, which fetch the envelope
          expect(regen.getState).not.toHaveBeenCalled();
          expect(regen.getPreState).not.toHaveBeenCalled();
        }
      );

      it("a block that names a payload the head does not is not held for a payload", async () => {
        // The head is a real node, no envelope makes this payload known: validation goes on to the state,
        // which is not available in this test
        const restarted = await setupRestarted((restarted) =>
          generateGloasBlockOnParent(restarted.headSlot + 1, restarted.headRoot, Buffer.alloc(32, 0x3a))
        );
        regen.getState.mockRejectedValue(new Error("no state"));
        regen.getPreState.mockRejectedValue(new Error("no state"));

        await expectRejectedWithLodestarError(
          validateGossipBlock(restarted.config, chain, gloasJob, ForkName.gloas),
          BlockErrorCode.PARENT_BLOCK_UNKNOWN
        );
        expect(regen.getState).toHaveBeenCalled();
      });
    });
  });
});
