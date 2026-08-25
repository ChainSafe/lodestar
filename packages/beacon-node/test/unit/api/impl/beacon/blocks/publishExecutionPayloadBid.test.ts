import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {
  ExecutionPayloadBidError,
  ExecutionPayloadBidErrorCode,
  GossipAction,
} from "../../../../../../src/chain/errors/index.js";
import {
  validateApiExecutionPayloadBid,
  validateGossipExecutionPayloadBid,
} from "../../../../../../src/chain/validation/executionPayloadBid.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";

vi.mock("../../../../../../src/chain/validation/executionPayloadBid.js", () => ({
  validateApiExecutionPayloadBid: vi.fn(),
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
    vi.mocked(validateApiExecutionPayloadBid).mockResolvedValue(true);
    vi.mocked(validateGossipExecutionPayloadBid).mockResolvedValue({proposerIndex: 0});
  });

  it("publishes the bid and adds it to the local pool", async () => {
    const api = getBeaconBlockApi(modules);
    await api.publishExecutionPayloadBid({signedExecutionPayloadBid: signedBid});

    expect(modules.network.publishSignedExecutionPayloadBid).toHaveBeenCalledWith(signedBid);
    expect(modules.chain.executionPayloadBidPool.add).toHaveBeenCalledWith(signedBid);
  });

  it("publishes the bid even if it fails gossip validation", async () => {
    vi.mocked(validateGossipExecutionPayloadBid).mockRejectedValue(
      new ExecutionPayloadBidError(GossipAction.IGNORE, {
        code: ExecutionPayloadBidErrorCode.INCOMPATIBLE_WITH_HEAD,
        slot: 1,
        parentBlockRoot: "0x",
        parentBlockHash: "0x",
        headBlockRoot: "0x",
      })
    );
    const api = getBeaconBlockApi(modules);
    await api.publishExecutionPayloadBid({signedExecutionPayloadBid: signedBid});

    expect(modules.network.publishSignedExecutionPayloadBid).toHaveBeenCalledWith(signedBid);
    // A bid that peers would not accept must not be picked up by a local proposer
    expect(modules.chain.executionPayloadBidPool.add).not.toHaveBeenCalled();
  });

  it("publishes the bid if the parent block is unknown", async () => {
    vi.mocked(validateApiExecutionPayloadBid).mockResolvedValue(false);
    const api = getBeaconBlockApi(modules);
    await api.publishExecutionPayloadBid({signedExecutionPayloadBid: signedBid});

    expect(modules.network.publishSignedExecutionPayloadBid).toHaveBeenCalledWith(signedBid);
    expect(modules.chain.logger.warn).toHaveBeenCalledWith(
      "Publishing execution payload bid on unknown parent block or state unavailable, skipped validation",
      expect.anything()
    );
  });

  it("does not publish a bid that fails the reject checks", async () => {
    vi.mocked(validateApiExecutionPayloadBid).mockRejectedValue(
      new ExecutionPayloadBidError(GossipAction.REJECT, {
        code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE,
        builderIndex: 3,
        slot: 1,
      })
    );
    const api = getBeaconBlockApi(modules);
    await expect(api.publishExecutionPayloadBid({signedExecutionPayloadBid: signedBid})).rejects.toThrow(
      ExecutionPayloadBidError
    );

    expect(modules.network.publishSignedExecutionPayloadBid).not.toHaveBeenCalled();
    expect(modules.chain.executionPayloadBidPool.add).not.toHaveBeenCalled();
  });
});
