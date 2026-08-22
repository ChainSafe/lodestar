import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {FAR_FUTURE_EPOCH, ForkName} from "@lodestar/params";
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
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).resolves.toBe(true);
    expect(chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
  });

  it("returns false if the parent block is unknown", async () => {
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).resolves.toBe(false);
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("returns false if the parent state cannot be regenerated", async () => {
    chain.regen.getBlockSlotState.mockRejectedValue(Error("no state"));
    await expect(validateApiExecutionPayloadBid(chain, signedBid)).resolves.toBe(false);
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
});
