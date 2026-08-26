import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, MAX_EXECUTION_PAYMENT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {BUILDER_BID_DEADLINE_MS} from "../../../../../src/execution/builder/apiClient.js";
import {validateBuilderApiExecutionPayloadBid} from "../../../../../src/execution/builder/validateBid.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {zeroProtoBlock} from "../../../../utils/state.js";

vi.mock("../../../../../src/execution/builder/validateBid.js", async (importActual) => ({
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
    // Move past the bid deadline so the p2p bid is selected without waiting
    vi.mocked(modules.chain.clock.msFromSlot).mockReturnValue(BUILDER_BID_DEADLINE_MS);
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

    expect(modules.chain.executionPayloadBidPool.getBestBid).toHaveBeenCalled();
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

    expect(modules.chain.executionPayloadBidPool.getBestBid).toHaveBeenCalled();
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
      auth: ssz.gloas.SignedBuilderRequestAuth.defaultValue(),
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
    // The bid block commits to the builder API bid since its boosted total (2) beats the p2p bid (1)
    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid: apiBid}));
    expect(block).toEqual(bidBlock);
  });

  it("counts a builder API bid's execution payment only up to its entry cap", async () => {
    const builderUrl = "https://builder.example.com";
    const entry = {
      url: new TextEncoder().encode(builderUrl),
      auth: ssz.gloas.SignedBuilderRequestAuth.defaultValue(),
      builderPubkeys: [],
      maxExecutionPayment: 1n,
      minBid: 0n,
      builderBoostFactor: 100n,
    };
    const apiBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    apiBid.message.value = 1;
    apiBid.message.executionPayment = 5n;
    apiBid.message.builderIndex = 7;
    const p2pBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    p2pBid.message.value = 3;
    p2pBid.message.builderIndex = 42;

    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(p2pBid);
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

    // The builder API bid counts as 1 + min(5, 1) = 2, so the p2p bid (3) wins
    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid: p2pBid}));
    expect(block).toEqual(bidBlock);
  });

  it("saturates builder API bid totals before ranking", async () => {
    const firstUrl = "https://first-builder.example.com";
    const secondUrl = "https://second-builder.example.com";
    const firstEntry = {
      url: new TextEncoder().encode(firstUrl),
      auth: ssz.gloas.SignedBuilderRequestAuth.defaultValue(),
      builderPubkeys: [],
      maxExecutionPayment: MAX_EXECUTION_PAYMENT,
      minBid: 0n,
      builderBoostFactor: 100n,
    };
    const secondEntry = {...firstEntry, url: new TextEncoder().encode(secondUrl)};
    const firstBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    firstBid.message.executionPayment = MAX_EXECUTION_PAYMENT;
    const secondBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    secondBid.message.value = 1;
    secondBid.message.executionPayment = MAX_EXECUTION_PAYMENT;

    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(null);
    modules.chain.getHeadState.mockReturnValue({getBeaconProposer: () => 1} as never);
    vi.spyOn(modules.chain.pubkeyCache, "getOrThrow").mockReturnValue({toBytes: () => new Uint8Array(48)} as never);
    modules.chain.builderApiClient.getExecutionPayloadBids.mockResolvedValue([
      {url: firstUrl, entry: firstEntry, signedBid: firstBid},
      {url: secondUrl, entry: secondEntry, signedBid: secondBid},
    ]);

    await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: {minBid: 0n, builderBoostFactor: 100n, builders: [firstEntry, secondEntry]},
    });

    // Both totals saturate at uint64 max, so the earlier bid wins the tie
    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid: firstBid}));
  });

  it("prefers the builder API bid over an equally boosted p2p bid", async () => {
    const builderUrl = "https://builder.example.com";
    const entry = {
      url: new TextEncoder().encode(builderUrl),
      auth: ssz.gloas.SignedBuilderRequestAuth.defaultValue(),
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
  });

  it("ranks builder bids without truncating boosted values", async () => {
    const builderUrl = "https://builder.example.com";
    const entry = {
      url: new TextEncoder().encode(builderUrl),
      auth: ssz.gloas.SignedBuilderRequestAuth.defaultValue(),
      builderPubkeys: [],
      maxExecutionPayment: 0n,
      minBid: 0n,
      builderBoostFactor: 100n,
    };
    const apiBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    apiBid.message.value = 1;
    const p2pBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    p2pBid.message.value = 1;

    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(p2pBid);
    modules.chain.getHeadState.mockReturnValue({getBeaconProposer: () => 1} as never);
    vi.spyOn(modules.chain.pubkeyCache, "getOrThrow").mockReturnValue({toBytes: () => new Uint8Array(48)} as never);
    modules.chain.builderApiClient.getExecutionPayloadBids.mockResolvedValue([
      {url: builderUrl, entry, signedBid: apiBid},
    ]);

    await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: {minBid: 0n, builderBoostFactor: 150n, builders: [entry]},
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid: p2pBid}));
  });

  it("prefers a max boost builder entry before comparing bid values", async () => {
    const builderUrl = "https://builder.example.com";
    const entry = {
      url: new TextEncoder().encode(builderUrl),
      auth: ssz.gloas.SignedBuilderRequestAuth.defaultValue(),
      builderPubkeys: [],
      maxExecutionPayment: 0n,
      minBid: 0n,
      builderBoostFactor: maxBuilderBoostFactor,
    };
    const apiBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    apiBid.message.value = 0;
    const p2pBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    p2pBid.message.value = 1;

    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(p2pBid);
    modules.chain.getHeadState.mockReturnValue({getBeaconProposer: () => 1} as never);
    vi.spyOn(modules.chain.pubkeyCache, "getOrThrow").mockReturnValue({toBytes: () => new Uint8Array(48)} as never);
    modules.chain.builderApiClient.getExecutionPayloadBids.mockResolvedValue([
      {url: builderUrl, entry, signedBid: apiBid},
    ]);

    await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderConfig: {minBid: 0n, builderBoostFactor: 100n, builders: [entry]},
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid: apiBid}));
  });

  it("falls back to the p2p bid when the builder API bid fails validation", async () => {
    const builderUrl = "https://builder.example.com";
    const entry = {
      url: new TextEncoder().encode(builderUrl),
      auth: ssz.gloas.SignedBuilderRequestAuth.defaultValue(),
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

    expect(modules.chain.executionPayloadBidPool.getBestBid).toHaveBeenCalled();
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

  type MatrixEntry = {value: number; executionPayment?: bigint; maxExecutionPayment?: bigint; boostFactor?: bigint};
  const selectionTestCases: {
    id: string;
    entries: MatrixEntry[];
    p2pValue: number | null;
    minBid?: bigint;
    builderBoostFactor?: bigint;
    engineValueGwei: number;
    /** Expected winner, the entry index of an api bid, the p2p bid or the local block */
    expected: number | "p2p" | "engine";
  }[] = [
    {id: "api bid outbids the p2p bid", entries: [{value: 2}], p2pValue: 1, engineValueGwei: 0, expected: 0},
    {id: "p2p bid outbids the api bid", entries: [{value: 2}], p2pValue: 3, engineValueGwei: 0, expected: "p2p"},
    {id: "tie prefers the api bid", entries: [{value: 2}], p2pValue: 2, engineValueGwei: 0, expected: 0},
    {
      id: "execution payment is counted up to the entry cap",
      entries: [{value: 1, executionPayment: 5n, maxExecutionPayment: 2n}],
      p2pValue: 2,
      engineValueGwei: 0,
      expected: 0,
    },
    {
      id: "execution payment above a zero cap is not counted",
      entries: [{value: 1, executionPayment: 5n, maxExecutionPayment: 0n}],
      p2pValue: 2,
      engineValueGwei: 0,
      expected: "p2p",
    },
    {
      id: "zero entry boost factor loses against the p2p bid",
      entries: [{value: 100, boostFactor: 0n}],
      p2pValue: 1,
      engineValueGwei: 0,
      expected: "p2p",
    },
    {
      id: "max entry boost factor wins regardless of value",
      entries: [{value: 0, boostFactor: maxBuilderBoostFactor}],
      p2pValue: 5,
      engineValueGwei: 0,
      expected: 0,
    },
    {
      id: "higher boosted api bid wins between builders",
      entries: [
        {value: 10, boostFactor: 100n},
        {value: 10, boostFactor: 200n},
      ],
      p2pValue: null,
      engineValueGwei: 0,
      expected: 1,
    },
    {
      id: "p2p bid below min bid is discarded",
      entries: [],
      p2pValue: 1,
      minBid: 2n,
      engineValueGwei: 0,
      expected: "engine",
    },
    {
      id: "local block beats a dampened api bid",
      entries: [{value: 100, boostFactor: 50n}],
      p2pValue: null,
      engineValueGwei: 100,
      expected: "engine",
    },
  ];

  for (const tc of selectionTestCases) {
    it(`bid selection - ${tc.id}`, async () => {
      const entries = tc.entries.map((_, i) => ({
        url: new TextEncoder().encode(`https://builder-${i}.example.com`),
        auth: ssz.gloas.SignedBuilderRequestAuth.defaultValue(),
        builderPubkeys: [],
        maxExecutionPayment: tc.entries[i].maxExecutionPayment ?? 0n,
        minBid: 0n,
        builderBoostFactor: tc.entries[i].boostFactor ?? 100n,
      }));
      const apiBids = tc.entries.map((e, i) => {
        const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
        signedBid.message.value = e.value;
        signedBid.message.executionPayment = e.executionPayment ?? 0n;
        signedBid.message.builderIndex = i;
        return {url: `https://builder-${i}.example.com`, entry: entries[i], signedBid};
      });
      const p2pBid = tc.p2pValue !== null ? ssz.gloas.SignedExecutionPayloadBid.defaultValue() : null;
      if (p2pBid !== null && tc.p2pValue !== null) {
        p2pBid.message.value = tc.p2pValue;
        p2pBid.message.builderIndex = 42;
      }

      modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
      modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(p2pBid);
      modules.chain.getHeadState.mockReturnValue({getBeaconProposer: () => 1} as never);
      vi.spyOn(modules.chain.pubkeyCache, "getOrThrow").mockReturnValue({toBytes: () => new Uint8Array(48)} as never);
      modules.chain.builderApiClient.getExecutionPayloadBids.mockResolvedValue(apiBids);
      modules.chain.produceBlock.mockImplementation(async (attrs: {builderBid?: unknown}) => ({
        block: attrs.builderBid !== undefined ? bidBlock : engineBlock,
        executionPayloadValue: BigInt(tc.engineValueGwei) * 10n ** 9n,
        consensusBlockValue: 0n,
      }));

      const {data: block} = await api.produceBlockV4({
        slot,
        randaoReveal,
        graffiti,
        feeRecipient,
        includePayload: false,
        builderConfig: {
          minBid: tc.minBid ?? 0n,
          builderBoostFactor: tc.builderBoostFactor ?? 100n,
          builders: entries,
        },
      });

      if (tc.expected === "engine") {
        expect(block).toEqual(engineBlock);
      } else {
        const expectedBid = tc.expected === "p2p" ? p2pBid : apiBids[tc.expected].signedBid;
        expect(block).toEqual(bidBlock);
        expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({builderBid: expectedBid}));
      }
    });
  }
});
