import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {FAR_FUTURE_EPOCH, ForkName, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ExecutionPayloadBidErrorCode} from "../../../../src/chain/errors/index.js";
import {validateApiExecutionPayloadBid} from "../../../../src/chain/validation/executionPayloadBid.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateApiExecutionPayloadBid", () => {
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
  const feeRecipient = Buffer.alloc(20, 7);
  const dependentRoot = `0x${"22".repeat(32)}`;
  const parentBlockRoot = `0x${"33".repeat(32)}`;
  const parentBlockHash = `0x${"44".repeat(32)}`;
  // Parent gas limit equal to the target makes `getExpectedGasLimitBigint` a no-op, so the only
  // compatible bid gas limit is exactly the target.
  const gasLimit = 150_000_000n;
  let chain: MockedBeaconChain;
  let signedBid: ReturnType<typeof ssz.gloas.SignedExecutionPayloadBid.defaultValue>;

  function mockProposerPreferences() {
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = 2;
    preferences.message.feeRecipient = feeRecipient;
    preferences.message.targetGasLimit = gasLimit;
    return preferences;
  }

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
    } as unknown as IBeaconStateView;
  }

  function mockParentPayloadVariant(parentGasLimit: bigint) {
    chain.forkChoice.getBlockHexAndBlockHash.mockReturnValue(
      generateProtoBlock({
        slot: 1,
        blockRoot: parentBlockRoot,
        executionPayloadBlockHash: parentBlockHash,
        executionPayloadGasLimit: Number(parentGasLimit),
      })
    );
  }

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(
      generateProtoBlock({slot: 1, blockRoot: parentBlockRoot})
    );
    const builder = ssz.gloas.Builder.defaultValue();
    builder.depositEpoch = 0;
    builder.withdrawableEpoch = FAR_FUTURE_EPOCH;
    chain.regen.getBlockSlotState.mockResolvedValue(mockState({builder}));
    chain.forkChoice.getDependentRoot.mockReturnValue(dependentRoot);
    chain.proposerPreferencesPool.get.mockReturnValue(mockProposerPreferences());
    mockParentPayloadVariant(gasLimit);
    signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = 2;
    signedBid.message.prevRandao = randaoMix;
    signedBid.message.blockHash = Buffer.alloc(32, 9);
    // Non-default, distinct values so `toHaveBeenCalledWith` on the two lookups below actually
    // pins the keys instead of matching an all-zero default.
    signedBid.message.parentBlockRoot = fromHex(parentBlockRoot);
    signedBid.message.parentBlockHash = fromHex(parentBlockHash);
    // `defaultValue()` yields a zeroed fee recipient and a zero gas limit, both of which would
    // make the proposer-preferences checks below pass or fail for the wrong reason.
    signedBid.message.feeRecipient = feeRecipient;
    signedBid.message.gasLimit = gasLimit;
    vi.mocked(chain.clock.isCurrentSlotGivenGossipDisparity).mockReturnValue(true);
  });

  it("accepts a valid bid", async () => {
    expect(await validateApiExecutionPayloadBid(chain, signedBid)).toBeUndefined();
    expect(chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
    // Pin the lookup keys. A wrong slot or dependent root silently resolves no preferences, which
    // fails open and makes the whole check a no-op while every other assertion here stays green.
    expect(chain.proposerPreferencesPool.get).toHaveBeenCalledWith(signedBid.message.slot, dependentRoot);
    expect(chain.forkChoice.getBlockHexAndBlockHash).toHaveBeenCalledWith(parentBlockRoot, parentBlockHash);
  });

  it("rejects a bid whose block hash equals its parent block hash", async () => {
    signedBid.message.blockHash = signedBid.message.parentBlockHash;
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BLOCK_HASH_EQUALS_PARENT_BLOCK_HASH},
    });
  });

  it("rejects a bid outside the slot window", async () => {
    vi.mocked(chain.clock.isCurrentSlotGivenGossipDisparity).mockReturnValue(false);
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INVALID_SLOT},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects if the parent block is unknown", async () => {
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects if the parent state cannot be regenerated", async () => {
    chain.regen.getBlockSlotState.mockRejectedValue(Error("no state"));
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects a bid not later than its parent", async () => {
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(generateProtoBlock({slot: 2}));
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.NOT_LATER_THAN_PARENT},
    });
  });

  it("rejects a non-zero execution payment", async () => {
    signedBid.message.executionPayment = 1n;
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.NON_ZERO_EXECUTION_PAYMENT},
    });
  });

  it("rejects a bid whose fee recipient does not match the proposer preferences", async () => {
    // The bid's payment is executed to `bid.fee_recipient` by `process_execution_payload_bid`,
    // which never constrains it, so a bid naming an address of the builder's choosing is a valid
    // block. Refusing to pool it is the only defence available.
    signedBid.message.feeRecipient = Buffer.alloc(20, 0xaa);
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {
        code: ExecutionPayloadBidErrorCode.PROPOSER_PREFERENCES_FEE_RECIPIENT_MISMATCH,
        bidFeeRecipient: `0x${"aa".repeat(20)}`,
        expectedFeeRecipient: `0x${"07".repeat(20)}`,
      },
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    // The check must stay ahead of the state regen, which is orders of magnitude more expensive
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("accepts a bid whose fee recipient cannot be checked because no preferences are pooled", async () => {
    // Fail open. This endpoint ORIGINATES a bid; both preference rules are IGNORE-level, so
    // refusing on missing local data (the pool cannot be backfilled for up to SLOTS_PER_EPOCH/4
    // slots after a restart) would suppress a bid every peer holding the data would forward.
    chain.proposerPreferencesPool.get.mockReturnValue(null);
    signedBid.message.feeRecipient = Buffer.alloc(20, 0xaa);
    expect(await validateApiExecutionPayloadBid(chain, signedBid)).toBeUndefined();
    expect(chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
  });

  it("accepts a bid whose dependent root cannot be derived", async () => {
    // Fail open, and `getShufflingDependentRoot`'s ForkChoiceError must not escape as a raw throw
    chain.forkChoice.getDependentRoot.mockImplementation(() => {
      throw Error("unknown ancestor");
    });
    signedBid.message.feeRecipient = Buffer.alloc(20, 0xaa);
    expect(await validateApiExecutionPayloadBid(chain, signedBid)).toBeUndefined();
    expect(chain.proposerPreferencesPool.get).not.toHaveBeenCalled();
  });

  it("rejects a bid whose gas limit is not compatible with the proposer's target", async () => {
    signedBid.message.gasLimit = gasLimit - 1_000_000n;
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {
        code: ExecutionPayloadBidErrorCode.PROPOSER_PREFERENCES_GAS_LIMIT_MISMATCH,
        bidGasLimit: gasLimit - 1_000_000n,
        parentGasLimit: gasLimit,
        targetGasLimit: gasLimit,
      },
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("accepts the clamped gas limit, not the raw target, when the target is far from the parent", async () => {
    // `is_gas_limit_target_compatible` is NOT equality against the target: EIP-1559 clamps the
    // step to `parentGasLimit / 1024 - 1`. Without this case the rule collapses to
    // `bid.gasLimit === targetGasLimit` and a regression would reject every honest bid during a
    // gas-limit ramp while every other test stays green.
    const parentGasLimit = 30_000_000n;
    const clamped = parentGasLimit + parentGasLimit / 1024n - 1n;
    expect(clamped).toBe(30_029_295n);
    mockParentPayloadVariant(parentGasLimit);

    signedBid.message.gasLimit = clamped;
    expect(await validateApiExecutionPayloadBid(chain, signedBid)).toBeUndefined();
  });

  it("rejects a bid at the raw target gas limit when the target is far from the parent", async () => {
    mockParentPayloadVariant(30_000_000n);

    signedBid.message.gasLimit = gasLimit;
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {
        code: ExecutionPayloadBidErrorCode.PROPOSER_PREFERENCES_GAS_LIMIT_MISMATCH,
        bidGasLimit: gasLimit,
        parentGasLimit: 30_000_000n,
        targetGasLimit: gasLimit,
      },
    });
  });

  it("rejects a bid declaring the maximum uint64 gas limit", async () => {
    // Such a bid is valid to `process_execution_payload_bid` but its envelope can never be
    // revealed, since `verify_execution_payload_envelope` binds `payload.gas_limit ==
    // bid.gas_limit` and no execution layer accepts it, forcing the slot empty.
    signedBid.message.gasLimit = 2n ** 64n - 1n;
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.PROPOSER_PREFERENCES_GAS_LIMIT_MISMATCH},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("accepts a bid whose gas limit cannot be checked because the parent payload variant is unknown", async () => {
    // Fail open on the gas-limit rule only; the fee recipient was already checked above it
    chain.forkChoice.getBlockHexAndBlockHash.mockReturnValue(null);
    signedBid.message.gasLimit = 2n ** 64n - 1n;
    expect(await validateApiExecutionPayloadBid(chain, signedBid)).toBeUndefined();
  });

  it("accepts a bid whose parent block has no execution payload", async () => {
    chain.forkChoice.getBlockHexAndBlockHash.mockReturnValue(generateProtoBlock({slot: 1}));
    signedBid.message.gasLimit = 2n ** 64n - 1n;
    expect(await validateApiExecutionPayloadBid(chain, signedBid)).toBeUndefined();
  });

  it("does not let a fork-choice lookup failure escape as a raw throw", async () => {
    // `protoArray.getNodeIndexByRootAndBlockHash` dereferences a possibly-undefined EMPTY variant
    // index, so this lookup can throw a TypeError rather than return null
    chain.forkChoice.getBlockHexAndBlockHash.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined");
    });
    expect(await validateApiExecutionPayloadBid(chain, signedBid)).toBeUndefined();
  });

  it("rejects an inactive builder", async () => {
    chain.regen.getBlockSlotState.mockResolvedValue(mockState());
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE},
    });
  });

  it("rejects a wrong randao mix", async () => {
    signedBid.message.prevRandao = Buffer.alloc(32, 2);
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INVALID_PREV_RANDAO},
    });
  });

  it("rejects an invalid signature", async () => {
    vi.mocked(chain.bls.verifySignatureSets).mockResolvedValue(false);
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE},
    });
  });

  it("rejects a bid with too many blob KZG commitments", async () => {
    const commitmentLimit = config.getMaxBlobsPerBlock(0);
    signedBid.message.blobKzgCommitments = Array.from({length: commitmentLimit + 1}, () => new Uint8Array(48));
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.TOO_MANY_KZG_COMMITMENTS},
    });

    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects a builder index out of bounds", async () => {
    // Exercises the explicit length guard (bid.builderIndex >= state.getBuildersLength()), which is a
    // separate branch from the "rejects an inactive builder" isActiveBuilder path. mockState() has one builder.
    signedBid.message.builderIndex = 1;
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE},
    });
  });

  it("rejects an invalid builder version", async () => {
    const builder = ssz.gloas.Builder.defaultValue();
    builder.depositEpoch = 0;
    builder.withdrawableEpoch = FAR_FUTURE_EPOCH;
    builder.version = PAYLOAD_BUILDER_VERSION + 1;
    chain.regen.getBlockSlotState.mockResolvedValue(mockState({builder}));
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
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
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BID_TOO_HIGH},
    });
  });
});
