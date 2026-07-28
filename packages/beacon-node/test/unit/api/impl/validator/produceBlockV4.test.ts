import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
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

  const slot = 2;
  const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";
  const graffiti = "a".repeat(32);

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
    modules.chain.forkChoice.getHead.mockReturnValue(parentBlock);
    modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(zeroProtoBlock);
    modules.chain.forkChoice.shouldBuildOnFull.mockReturnValue(true);
    modules.chain.produceBlock.mockImplementation(async (attrs: {builderBid?: unknown}) => ({
      block: attrs.builderBid !== undefined ? bidBlock : engineBlock,
      executionPayloadValue: BigInt(0),
      consensusBlockValue: BigInt(0),
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

  it("skips builder bids with executiononly selection", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);

    const {data: block} = await api.produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      includePayload: false,
      builderSelection: routes.validator.BuilderSelection.ExecutionOnly,
    });

    expect(modules.chain.executionPayloadBidPool.getBestBid).not.toHaveBeenCalled();
    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(1);
    expect(block).toEqual(engineBlock);
  });

  it("produces local block when no bid is available", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(null);

    const {data: block} = await api.produceBlockV4({slot, randaoReveal, graffiti, feeRecipient, includePayload: false});

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(1);
    expect(block).toEqual(engineBlock);
  });

  it("retries local production on the canonical head if proposer reorg local production fails", async () => {
    const reorgParentBlock = {
      ...parentBlock,
      slot: slot - 2,
      blockRoot: "0x2222222222222222222222222222222222222222222222222222222222222222",
      executionPayloadBlockHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    } as ProtoBlock;

    modules.chain.getProposerHead.mockReturnValue(reorgParentBlock);
    modules.chain.forkChoice.getHead.mockReturnValue(parentBlock);
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(null);
    modules.chain.produceBlock
      .mockRejectedValueOnce(new Error("Received invalid payloadId=null"))
      .mockResolvedValueOnce({
        block: engineBlock,
        executionPayloadValue: BigInt(0),
        consensusBlockValue: BigInt(0),
      });

    const {data: block} = await api.produceBlockV4({slot, randaoReveal, graffiti, feeRecipient, includePayload: false});

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(modules.chain.produceBlock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({parentBlock: reorgParentBlock})
    );
    expect(modules.chain.produceBlock).toHaveBeenNthCalledWith(2, expect.objectContaining({parentBlock}));
    expect(block).toEqual(engineBlock);
  });

  it("does not retry local production if canonical head cannot directly parent the block", async () => {
    const reorgParentBlock = {
      ...parentBlock,
      slot: slot - 2,
      blockRoot: "0x2222222222222222222222222222222222222222222222222222222222222222",
      executionPayloadBlockHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    } as ProtoBlock;
    const oldCanonicalHead = {...parentBlock, slot: slot - 2} as ProtoBlock;

    modules.chain.getProposerHead.mockReturnValue(reorgParentBlock);
    modules.chain.forkChoice.getHead.mockReturnValue(oldCanonicalHead);
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(null);
    modules.chain.produceBlock.mockRejectedValueOnce(new Error("Received invalid payloadId=null"));

    await expect(
      api.produceBlockV4({slot, randaoReveal, graffiti, feeRecipient, includePayload: false})
    ).rejects.toThrow("Received invalid payloadId=null");

    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(1);
    expect(modules.chain.produceBlock).toHaveBeenCalledWith(expect.objectContaining({parentBlock: reorgParentBlock}));
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

  it("treats deprecated builderonly selection as builderalways", async () => {
    modules.chain.builderCircuitBreaker.isActive.mockReturnValue(false);
    modules.chain.executionPayloadBidPool.getBestBid.mockReturnValue(builderBid);
    // Bid (1 gwei) is preferred over the higher local payload value (2 gwei) since builderalways
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
      builderSelection: routes.validator.BuilderSelection.BuilderOnly,
    });

    expect(modules.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Builder selection builderonly is no longer supported")
    );
    expect(modules.chain.produceBlock).toHaveBeenCalledTimes(2);
    expect(block).toEqual(bidBlock);
  });
});
