import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {FAR_FUTURE_EPOCH, ForkName, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
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
    } as unknown as IBeaconStateView;
  }

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(generateProtoBlock({slot: 1}));
    const builder = ssz.gloas.Builder.defaultValue();
    builder.depositEpoch = 0;
    builder.withdrawableEpoch = FAR_FUTURE_EPOCH;
    chain.regen.getBlockSlotState.mockResolvedValue(mockState({builder}));
    signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = 2;
    signedBid.message.prevRandao = randaoMix;
  });

  it("accepts a valid bid", async () => {
    expect(await validateApiExecutionPayloadBid(chain, signedBid)).toBeUndefined();
    expect(chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
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
});
