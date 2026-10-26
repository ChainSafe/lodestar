import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {FAR_FUTURE_EPOCH, ForkName, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionPayloadBidErrorCode} from "../../../../src/chain/errors/index.js";
import {validateGossipExecutionPayloadBid} from "../../../../src/chain/validation/executionPayloadBid.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateGossipExecutionPayloadBid", () => {
  const config = createBeaconConfig(
    createChainForkConfig({
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    }),
    Buffer.alloc(32, 0)
  );
  const randaoMix = Buffer.alloc(32, 1);
  const parentBlockRoot = Buffer.alloc(32, 5);
  const parentBlockHash = Buffer.alloc(32, 6);
  const dependentRoot = toRootHex(Buffer.alloc(32, 7));
  const proposerIndex = 11;
  let chain: MockedBeaconChain;
  let signedBid: ReturnType<typeof ssz.gloas.SignedExecutionPayloadBid.defaultValue>;

  function mockState(overrides: Partial<{builder: ReturnType<typeof ssz.gloas.Builder.defaultValue>}> = {}) {
    const builder = overrides.builder ?? ssz.gloas.Builder.defaultValue();
    return {
      forkName: ForkName.gloas,
      slot: 2,
      finalizedCheckpoint: {epoch: 1},
      getBuildersLength: () => 1,
      getBuilder: () => builder,
      getRandaoMix: () => randaoMix,
      canBuilderCoverBid: () => true,
      latestExecutionPayloadBid: {blockHash: Buffer.alloc(32, 0)},
    } as unknown as IBeaconStateView;
  }

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    const parentBlock = generateProtoBlock({
      slot: 1,
      blockRoot: toRootHex(parentBlockRoot),
      executionPayloadBlockHash: toRootHex(parentBlockHash),
      executionPayloadGasLimit: 0,
    });
    chain.forkChoice.getHead.mockReturnValue(parentBlock);
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(parentBlock);
    chain.forkChoice.getBlockHexAndBlockHash.mockReturnValue(parentBlock);
    chain.forkChoice.shouldBuildOnFull.mockReturnValue(true);
    chain.forkChoice.getDependentRoot.mockReturnValue(dependentRoot);
    const proposerPreferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    proposerPreferences.message.validatorIndex = proposerIndex;
    vi.mocked(chain.proposerPreferencesPool.get).mockReturnValue(proposerPreferences);
    chain.executionPayloadBidPool.getBestBid.mockReturnValue(null);
    const builder = ssz.gloas.Builder.defaultValue();
    builder.depositEpoch = 0;
    builder.withdrawableEpoch = FAR_FUTURE_EPOCH;
    chain.regen.getBlockSlotState.mockResolvedValue(mockState({builder}));
    signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = 2;
    signedBid.message.parentBlockRoot = parentBlockRoot;
    signedBid.message.parentBlockHash = parentBlockHash;
    signedBid.message.prevRandao = randaoMix;
    signedBid.message.blockHash = Buffer.alloc(32, 9);
    vi.mocked(chain.clock.isCurrentSlotGivenGossipDisparity).mockReturnValue(true);
  });

  it("accepts a valid bid", async () => {
    expect(await validateGossipExecutionPayloadBid(chain, signedBid)).toEqual({proposerIndex});
    expect(chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
    expect(
      chain.seenExecutionPayloadBids.isKnown(
        signedBid.message.slot,
        signedBid.message.builderIndex,
        toRootHex(parentBlockHash),
        toRootHex(parentBlockRoot)
      )
    ).toBe(true);
  });

  it("rejects a bid whose block hash equals its parent block hash", async () => {
    signedBid.message.blockHash = signedBid.message.parentBlockHash;
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BLOCK_HASH_EQUALS_PARENT_BLOCK_HASH},
    });
  });

  it("rejects a bid outside the slot window", async () => {
    vi.mocked(chain.clock.isCurrentSlotGivenGossipDisparity).mockReturnValue(false);
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INVALID_SLOT},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("ignores a bid incompatible with the head branch", async () => {
    chain.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 1, blockRoot: toRootHex(Buffer.alloc(32, 8))}));
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INCOMPATIBLE_WITH_HEAD},
    });
  });

  it("ignores an already known bid", async () => {
    await validateGossipExecutionPayloadBid(chain, signedBid);
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BID_ALREADY_KNOWN},
    });
  });

  it("rejects if the parent block is unknown", async () => {
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects if the parent state cannot be regenerated", async () => {
    chain.regen.getBlockSlotState.mockRejectedValue(Error("no state"));
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects a bid not later than its parent", async () => {
    const parentBlock = generateProtoBlock({
      slot: 2,
      blockRoot: toRootHex(parentBlockRoot),
      executionPayloadBlockHash: toRootHex(parentBlockHash),
    });
    chain.forkChoice.getHead.mockReturnValue(parentBlock);
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(parentBlock);
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.NOT_LATER_THAN_PARENT},
    });
  });

  it("ignores a bid without matching proposer preferences", async () => {
    vi.mocked(chain.proposerPreferencesPool.get).mockReturnValue(null);
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.NO_MATCHING_PROPOSER_PREFERENCES},
    });
  });

  it("rejects a non-zero execution payment", async () => {
    signedBid.message.executionPayment = 1n;
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.NON_ZERO_EXECUTION_PAYMENT},
    });
  });

  it("rejects an inactive builder", async () => {
    chain.regen.getBlockSlotState.mockResolvedValue(mockState());
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE},
    });
  });

  it("ignores a bid that does not exceed the current best bid", async () => {
    const bestBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    bestBid.message.value = 100;
    chain.executionPayloadBidPool.getBestBid.mockReturnValue({signedBid: bestBid, receivedMs: 0} as ReturnType<
      typeof chain.executionPayloadBidPool.getBestBid
    >);
    signedBid.message.value = 100;
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BID_TOO_LOW},
    });
  });

  it("rejects a wrong randao mix", async () => {
    signedBid.message.prevRandao = Buffer.alloc(32, 2);
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INVALID_PREV_RANDAO},
    });
  });

  it("rejects an invalid signature", async () => {
    vi.mocked(chain.bls.verifySignatureSets).mockResolvedValue(false);
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE},
    });
  });

  it("rejects a bid with too many blob KZG commitments", async () => {
    const commitmentLimit = config.getMaxBlobsPerBlock(0);
    signedBid.message.blobKzgCommitments = Array.from({length: commitmentLimit + 1}, () => new Uint8Array(48));
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.TOO_MANY_KZG_COMMITMENTS},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects a builder index out of bounds", async () => {
    // Exercises the explicit length guard (bid.builderIndex >= state.getBuildersLength()), which is a
    // separate branch from the "rejects an inactive builder" isActiveBuilder path. mockState() has one builder.
    signedBid.message.builderIndex = 1;
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE},
    });
  });

  it("rejects an invalid builder version", async () => {
    const builder = ssz.gloas.Builder.defaultValue();
    builder.depositEpoch = 0;
    builder.withdrawableEpoch = FAR_FUTURE_EPOCH;
    builder.version = PAYLOAD_BUILDER_VERSION + 1;
    chain.regen.getBlockSlotState.mockResolvedValue(mockState({builder}));
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INVALID_BUILDER_VERSION},
    });
  });

  it("rejects on insufficient builder balance", async () => {
    const builder = ssz.gloas.Builder.defaultValue();
    builder.depositEpoch = 0;
    builder.withdrawableEpoch = FAR_FUTURE_EPOCH;
    const mockedState = mockState({builder});
    (mockedState as any).canBuilderCoverBid = () => false;
    chain.regen.getBlockSlotState.mockResolvedValue(mockedState);
    await expect(validateGossipExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BID_TOO_HIGH},
    });
  });
});
