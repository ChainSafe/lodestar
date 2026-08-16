import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {validateBuilderApiExecutionPayloadBid} from "../../../../../src/chain/validation/executionPayloadBid.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {zeroProtoBlock} from "../../../../utils/state.js";

vi.mock("../../../../../src/chain/validation/executionPayloadBid.js", async (importActual) => ({
  ...(await importActual<object>()),
  validateBuilderApiExecutionPayloadBid: vi.fn().mockResolvedValue(undefined),
}));

describe("api/validator - produceBlockV4", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  const slot = 1;
  const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";
  const graffiti = "a".repeat(32);
  const maxBuilderBoostFactor = 2n ** 64n - 1n;

  function getBuilderConfig(overrides: {minBid?: bigint; builderBoostFactor?: bigint} = {}) {
    return {minBid: 0n, builderBoostFactor: 100n, builders: [], ...overrides};
  }

  const engineBlock = ssz.gloas.BeaconBlock.defaultValue();
  engineBlock.slot = slot;
  engineBlock.proposerIndex = 1;
  const bidBlock = ssz.gloas.BeaconBlock.defaultValue();
  bidBlock.slot = slot;
  bidBlock.proposerIndex = 2;

  const builderBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  builderBid.message.value = 1;
  builderBid.message.builderIndex = 42;

  const parentBlock = {
    blockRoot: "0x1111111111111111111111111111111111111111111111111111111111111111",
    slot: slot - 1,
    executionPayloadBlockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    parentBlockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  } as ProtoBlock;

  const randaoReveal = engineBlock.body.randaoReveal;

  beforeEach(() => {
    modules = getApiTestModules({config});
    api = getValidatorApi(defaultApiOptions, {...modules, config});

    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(slot);
    vi.mocked(modules.chain.clock.msFromSlot).mockReturnValue(0);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
    modules.chain.getProposerHead.mockReturnValue(parentBlock);
    modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(zeroProtoBlock);
    modules.chain.forkChoice.shouldBuildOnFull.mockReturnValue(true);
    modules.chain.produceBlock.mockImplementation(async (attrs: {builderBid?: unknown}) => ({
      block: attrs.builderBid !== undefined ? bidBlock : engineBlock,
      executionPayloadValue: 0n,
      consensusBlockValue: 0n,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("picks builder bid block when bid value is higher", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);

    const {data: block, meta} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig(),
    });

    expect(modules.chain.executionPayloadBidPool.getBestBid).toHaveBeenCalledWith(
      slot,
      parentBlock.executionPayloadBlockHash,
      parentBlock.blockRoot
    );
    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(block).toEqual(bidBlock);
    expect(meta.version).toBe(ForkName.gloas);
  });

  it("picks local block when local payload value is higher", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);
    // Local payload value (2 gwei) exceeds the bid value (1 gwei)
    modules.chain.produceBlock.mockImplementation(async (attrs: {builderBid?: unknown}) => ({
      block: attrs.builderBid !== undefined ? bidBlock : engineBlock,
      executionPayloadValue: 2_000_000_000n,
      consensusBlockValue: 0n,
    }));

    const {data: block, meta} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig(),
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(block).toEqual(engineBlock);
    expect(meta.executionPayloadValue).toBe(2_000_000_000n);
  });

  it("prefers the local payload with a zero builder boost factor", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig({builderBoostFactor: 0n}),
    });

    expect(modules.chain.executionPayloadBidPool.getBestBid).toHaveBeenCalledOnce();
    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(block).toEqual(engineBlock);
  });

  it("uses a builder bid as fallback when local production fails with a zero boost factor", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);
    modules.chain.produceBlock.mockImplementation(async (attrs: {builderBid?: unknown}) => {
      if (attrs.builderBid === undefined) {
        throw new Error("Local block production failed");
      }

      return {block: bidBlock, executionPayloadValue: 0n, consensusBlockValue: 0n};
    });

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig({builderBoostFactor: 0n}),
    });

    expect(modules.chain.executionPayloadBidPool.getBestBid).toHaveBeenCalledOnce();
    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(block).toEqual(bidBlock);
  });

  it("uses a builder bid as fallback when the local fee recipient does not match", async () => {
    const builderBlock = ssz.gloas.BeaconBlock.defaultValue();

    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);
    modules.chain.produceBlock.mockImplementation(
      async (attrs: {builderBid?: unknown; strictFeeRecipientCheck?: boolean}) => {
        if (attrs.builderBid === undefined && attrs.strictFeeRecipientCheck) {
          throw new Error("Invalid feeRecipient set in engine payload");
        }

        return {block: builderBlock, executionPayloadValue: 0n, consensusBlockValue: 0n};
      }
    );

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      strictFeeRecipientCheck: true,
      includePayload: false,
      builderConfig: getBuilderConfig({builderBoostFactor: 0n}),
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({strictFeeRecipientCheck: true}));
    expect(block).toEqual(builderBlock);
  });

  it("picks a builder API bid over a lower p2p bid and records the bid source", async () => {
    const builderUrl = "https://builder.example.com";
    const entry = {
      url: new TextEncoder().encode(builderUrl),
      auth: ssz.gloas.SignedRequestAuth.defaultValue(),
      builderPubkeys: [],
      maxExecutionPayment: 0n,
      minBid: 0n,
      builderBoostFactor: 100n,
    };
    const apiBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    apiBid.message.value = 2;
    apiBid.message.builderIndex = 7;

    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);
    modules.chain.getHeadState.mockReturnValue({getBeaconProposer: () => 1} as never);
    vi.spyOn(modules.chain.pubkeyCache, "getOrThrow").mockReturnValue({toBytes: () => new Uint8Array(48)} as never);
    modules.chain.builderApiClient.getExecutionPayloadBids.mockResolvedValue([
      {url: builderUrl, entry, signedBid: apiBid},
    ]);

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: {minBid: 0n, builderBoostFactor: 100n, builders: [entry]},
    });

    expect(modules.chain.builderApiClient.getExecutionPayloadBids).toHaveBeenCalledOnce();
    expect(validateBuilderApiExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(validateBuilderApiExecutionPayloadBid).toHaveBeenCalledWith(
      modules.chain,
      apiBid,
      expect.objectContaining({feeRecipient: fromHex(feeRecipient)})
    );
    // The bid block commits to the builder API bid since its boosted total (2) beats the p2p bid (1)
    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid: apiBid}));
    expect(block).toEqual(bidBlock);
    expect(modules.chain.builderApiClient.recordBidSource).toHaveBeenCalledWith(slot, {
      url: builderUrl,
      bidBlockHash: expect.any(String),
    });
  });

  it("prefers the builder API bid over an equally boosted p2p bid", async () => {
    const builderUrl = "https://builder.example.com";
    const entry = {
      url: new TextEncoder().encode(builderUrl),
      auth: ssz.gloas.SignedRequestAuth.defaultValue(),
      builderPubkeys: [],
      maxExecutionPayment: 0n,
      minBid: 0n,
      builderBoostFactor: 100n,
    };
    // Same bid value as the p2p bid, the builder API copy must win the tie
    const apiBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    apiBid.message.value = builderBid.message.value;

    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);
    modules.chain.getHeadState.mockReturnValue({getBeaconProposer: () => 1} as never);
    vi.spyOn(modules.chain.pubkeyCache, "getOrThrow").mockReturnValue({toBytes: () => new Uint8Array(48)} as never);
    modules.chain.builderApiClient.getExecutionPayloadBids.mockResolvedValue([
      {url: builderUrl, entry, signedBid: apiBid},
    ]);

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: {minBid: 0n, builderBoostFactor: 100n, builders: [entry]},
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid: apiBid}));
    expect(block).toEqual(bidBlock);
    expect(modules.chain.builderApiClient.recordBidSource).toHaveBeenCalledOnce();
  });

  it("falls back to the p2p bid when the builder API bid fails validation", async () => {
    const builderUrl = "https://builder.example.com";
    const entry = {
      url: new TextEncoder().encode(builderUrl),
      auth: ssz.gloas.SignedRequestAuth.defaultValue(),
      builderPubkeys: [],
      maxExecutionPayment: 0n,
      minBid: 0n,
      builderBoostFactor: 100n,
    };
    const apiBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    apiBid.message.value = 2;

    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);
    modules.chain.getHeadState.mockReturnValue({getBeaconProposer: () => 1} as never);
    vi.spyOn(modules.chain.pubkeyCache, "getOrThrow").mockReturnValue({toBytes: () => new Uint8Array(48)} as never);
    modules.chain.builderApiClient.getExecutionPayloadBids.mockResolvedValue([
      {url: builderUrl, entry, signedBid: apiBid},
    ]);
    vi.mocked(validateBuilderApiExecutionPayloadBid).mockRejectedValueOnce(new Error("Invalid bid"));

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: {minBid: 0n, builderBoostFactor: 100n, builders: [entry]},
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid}));
    expect(block).toEqual(bidBlock);
    expect(modules.chain.builderApiClient.recordBidSource).not.toHaveBeenCalled();
  });

  it("ignores a p2p bid below the configured min bid", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    // Bid total payment is 1 gwei, below the configured floor of 2 gwei
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig({minBid: 2n}),
    });

    expect(modules.chain.executionPayloadBidPool.getBestBid).toHaveBeenCalledOnce();
    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(1);
    expect(block).toEqual(engineBlock);
  });

  it("produces local block when no bid is available", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(null);

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig(),
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(1);
    expect(block).toEqual(engineBlock);
  });

  it("ignores builder bids when the builder circuit breaker is active", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(true);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig(),
    });

    expect(modules.chain.builderCircuitBreaker.isActive).toHaveBeenCalledWith(slot, parentBlock);
    expect(modules.chain.executionPayloadBidPool.getBestBid).not.toHaveBeenCalled();
    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(1);
    expect(block).toEqual(engineBlock);
  });

  it("prefers the builder bid with the maximum builder boost factor", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);
    // Bid (1 gwei) is preferred over the higher local payload value (2 gwei)
    modules.chain.produceBlock.mockImplementation(async (attrs: {builderBid?: unknown}) => ({
      block: attrs.builderBid !== undefined ? bidBlock : engineBlock,
      executionPayloadValue: 2_000_000_000n,
      consensusBlockValue: 0n,
    }));

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig({builderBoostFactor: maxBuilderBoostFactor}),
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(block).toEqual(bidBlock);
  });

  it("persists a builder bid block with the builder source", async () => {
    const persistBlock = vi.fn();
    Object.defineProperty(modules.chain, "persistBlock", {value: persistBlock});
    modules.chain.opts.persistProducedBlocks = true;
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: getBuilderConfig(),
    });

    expect(block).toEqual(bidBlock);
    expect(persistBlock).toHaveBeenCalledWith(bidBlock, "produced_builder_block");
  });

  it("rejects block production if parent block is optimistic", async () => {
    modules.chain.getProposerHead.mockReturnValue({
      ...parentBlock,
      executionStatus: ExecutionStatus.Syncing,
    } as ProtoBlock);

    await expect(
      api.produceBlockV4({
        slot,
        randaoReveal,
        graffiti,
        feeRecipient,
        includePayload: false,
        builderConfig: getBuilderConfig(),
      })
    ).rejects.toThrow("Node is syncing");

    expect(modules.chain.produceBlock).not.toHaveBeenCalled();
  });
});
