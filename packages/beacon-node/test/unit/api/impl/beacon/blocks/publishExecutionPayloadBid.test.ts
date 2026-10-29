import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {
  ExecutionPayloadBidError,
  ExecutionPayloadBidErrorCode,
  GossipAction,
} from "../../../../../../src/chain/errors/index.js";
import {validateGossipExecutionPayloadBid} from "../../../../../../src/chain/validation/executionPayloadBid.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";

vi.mock("../../../../../../src/chain/validation/executionPayloadBid.js", () => ({
  validateGossipExecutionPayloadBid: vi.fn(),
}));

describe("api - beacon - publishExecutionPayloadBid", () => {
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  let modules: ApiTestModules;
  const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  signedBid.message.slot = 1;
  signedBid.message.builderIndex = 3;

  beforeEach(() => {
    vi.clearAllMocks();
    modules = getApiTestModules({config});
    modules.network.publishSignedExecutionPayloadBid = vi.fn().mockResolvedValue(5);
    vi.mocked(validateGossipExecutionPayloadBid).mockResolvedValue({proposerIndex: 7});
  });

  it("validates the bid before publishing by default", async () => {
    const api = getBeaconBlockApi(defaultApiOptions, modules);
    await api.publishExecutionPayloadBid({signedExecutionPayloadBid: signedBid});

    expect(validateGossipExecutionPayloadBid).toHaveBeenCalledWith(modules.chain, signedBid);
    expect(modules.chain.executionPayloadBidPool.add).toHaveBeenCalledWith(signedBid, expect.any(Number));
    expect(modules.network.publishSignedExecutionPayloadBid).toHaveBeenCalledWith(signedBid);
  });

  it("publishes the bid without validation if disabled", async () => {
    const api = getBeaconBlockApi({...defaultApiOptions, disableBidValidation: true}, modules);
    await api.publishExecutionPayloadBid({signedExecutionPayloadBid: signedBid});

    expect(validateGossipExecutionPayloadBid).not.toHaveBeenCalled();
    expect(modules.chain.executionPayloadBidPool.add).not.toHaveBeenCalled();
    expect(modules.network.publishSignedExecutionPayloadBid).toHaveBeenCalledWith(signedBid);
  });

  it("does not publish a bid that fails the reject checks", async () => {
    vi.mocked(validateGossipExecutionPayloadBid).mockRejectedValue(
      new ExecutionPayloadBidError(GossipAction.REJECT, {
        code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE,
        builderIndex: 3,
        slot: 1,
      })
    );
    const api = getBeaconBlockApi(defaultApiOptions, modules);
    await expect(api.publishExecutionPayloadBid({signedExecutionPayloadBid: signedBid})).rejects.toThrow(
      ExecutionPayloadBidError
    );

    expect(modules.chain.executionPayloadBidPool.add).not.toHaveBeenCalled();
    expect(modules.network.publishSignedExecutionPayloadBid).not.toHaveBeenCalled();
  });
});
