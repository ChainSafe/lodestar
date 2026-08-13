import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {zeroProtoBlock} from "../../../../utils/state.js";

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
      executionPayloadValue: BigInt(0),
      consensusBlockValue: BigInt(0),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
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
      executionPayloadValue: BigInt(2e9),
      consensusBlockValue: BigInt(0),
    }));

    const {data: block, meta} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(block).toEqual(engineBlock);
    expect(meta.executionPayloadValue).toBe(BigInt(2e9));
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
      builderBoostFactor: BigInt(0),
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

      return {block: bidBlock, executionPayloadValue: BigInt(0), consensusBlockValue: BigInt(0)};
    });

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderBoostFactor: BigInt(0),
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

        return {block: builderBlock, executionPayloadValue: BigInt(0), consensusBlockValue: BigInt(0)};
      }
    );

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      strictFeeRecipientCheck: true,
      includePayload: false,
      builderBoostFactor: BigInt(0),
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({strictFeeRecipientCheck: true}));
    expect(block).toEqual(builderBlock);
  });

  it("produces local block when no bid is available", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(null);

    const {data: block} = await api.produceBlockV4({slot, randaoReveal, graffiti, feeRecipient, includePayload: false});

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(1);
    expect(block).toEqual(engineBlock);
  });

  it("ignores builder bids when the builder circuit breaker is active", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(true);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);

    const {data: block} = await api.produceBlockV4({slot, randaoReveal, graffiti, feeRecipient, includePayload: false});

    expect(modules.chain.builderCircuitBreaker.isActive).toHaveBeenCalledWith(slot);
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
      executionPayloadValue: BigInt(2e9),
      consensusBlockValue: BigInt(0),
    }));

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderBoostFactor: maxBuilderBoostFactor,
    });

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(block).toEqual(bidBlock);
  });

  it("delays a final-slot proposal until the configured point in the slot", async () => {
    vi.useFakeTimers();
    const proposalSlot = SLOTS_PER_EPOCH - 1;
    const delayBps = 100;
    const delay = config.getSlotComponentDurationMs(delayBps);
    Object.assign(modules.chain.opts, {
      adversarialReorgDelayLastSlotProposal: true,
      adversarialReorgLastSlotProposalDelayBps: delayBps,
    });
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(proposalSlot);
    vi.mocked(modules.chain.clock.msFromSlot).mockReturnValue(0);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(null);

    let resolved = false;
    const producePromise = api
      .produceBlockV4({
        slot: proposalSlot,
        randaoReveal,
        graffiti,
        feeRecipient,
        includePayload: false,
      })
      .then((result) => {
        resolved = true;
        return result;
      });

    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await producePromise;

    expect(modules.logger.warn).toHaveBeenCalledWith("ADVERSARIAL: Delaying last-slot block proposal", {
      slot: proposalSlot,
      delayBps,
      delayMs: delay,
    });
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
      api.produceBlockV4({slot, randaoReveal, graffiti, feeRecipient, includePayload: false})
    ).rejects.toThrow("Node is syncing");

    expect(modules.chain.produceBlock).not.toHaveBeenCalled();
  });
});
