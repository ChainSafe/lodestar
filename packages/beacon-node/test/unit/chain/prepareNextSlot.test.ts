import {Mock, MockInstance, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {capella} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IChainOptions} from "../../../src/chain/options.js";
import {PrepareNextSlotScheduler} from "../../../src/chain/prepareNextSlot.js";
import {PayloadIdCache} from "../../../src/execution/engine/payloadIdCache.js";
import {MockedLogger, getMockedLogger} from "../../mocks/loggerMock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {generateCachedBellatrixState, zeroProtoBlock} from "../../utils/state.js";

describe("PrepareNextSlot scheduler", () => {
  const abortController = new AbortController();

  let chainStub: MockedBeaconChain;
  let scheduler: PrepareNextSlotScheduler;
  let forkChoiceStub: MockedBeaconChain["forkChoice"];
  let regenStub: MockedBeaconChain["regen"];
  let loggerStub: MockedLogger;
  let beaconProposerCacheStub: MockedBeaconChain["beaconProposerCache"];
  let getForkStub: MockInstance<(_: number) => ForkName>;
  let updateBuilderStatus: MockedBeaconChain["updateBuilderStatus"];
  let executionEngineStub: MockedBeaconChain["executionEngine"];
  const emitPayloadAttributes = true;
  const proposerIndex = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    chainStub = getMockedBeaconChain({clock: "real", genesisTime: 0});
    updateBuilderStatus = chainStub.updateBuilderStatus;
    forkChoiceStub = chainStub.forkChoice;
    regenStub = chainStub.regen;
    loggerStub = getMockedLogger();
    beaconProposerCacheStub = chainStub.beaconProposerCache;

    getForkStub = vi.spyOn(config, "getForkName");
    executionEngineStub = chainStub.executionEngine;
    vi.spyOn(chainStub, "opts", "get").mockReturnValue({emitPayloadAttributes} as IChainOptions);

    scheduler = new PrepareNextSlotScheduler(chainStub, config, null, loggerStub, abortController.signal);

    vi.spyOn(regenStub, "getBlockSlotState");
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  it("pre bellatrix - should not run due to not last slot of epoch", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    await scheduler.prepareForNextSlot(3);
    expect(chainStub.recomputeForkChoiceHead).not.toHaveBeenCalled();
  });

  it("pre bellatrix - should skip, headSlot is more than 1 epoch to prepare slot", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 2} as ProtoBlock);
    await Promise.all([
      scheduler.prepareForNextSlot(2 * SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("pre bellatrix - should run regen.getBlockSlotState", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    (regenStub.getBlockSlotState as Mock).mockResolvedValue(undefined);
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
  });

  it("pre bellatrix - should handle regen.getBlockSlotState error", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    regenStub.getBlockSlotState.mockRejectedValue("Unit test error");
    expect(loggerStub.error).not.toHaveBeenCalled();
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
    expect(loggerStub.error).toHaveBeenCalledTimes(1);
  });

  it("bellatrix - should skip, headSlot is more than 1 epoch to prepare slot", async () => {
    getForkStub.mockReturnValue(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 2} as ProtoBlock);
    await Promise.all([
      scheduler.prepareForNextSlot(2 * SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("bellatrix - should skip, no block proposer", async () => {
    getForkStub.mockReturnValue(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    const state = new BeaconStateView(generateCachedBellatrixState());
    regenStub.getBlockSlotState.mockResolvedValue(state);
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
  });

  it("bellatrix - should prepare payload", async () => {
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    getForkStub.mockReturnValue(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    chainStub.predictProposerHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getJustifiedBlock.mockReturnValue({} as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({} as ProtoBlock);
    updateBuilderStatus.mockReturnValue(void 0);
    const state = generateCachedBellatrixState();
    vi.spyOn(state.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);
    regenStub.getBlockSlotState.mockResolvedValue(new BeaconStateView(state));
    beaconProposerCacheStub.get.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
    expect(updateBuilderStatus).toHaveBeenCalledOnce();
    expect(forkChoiceStub.getJustifiedBlock).toHaveBeenCalledOnce();
    expect(forkChoiceStub.getFinalizedBlock).toHaveBeenCalledOnce();
    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gloas - should prepare payload using latestExecutionPayloadBid.blockHash when shouldExtendPayload is true", async () => {
    const payloadAttributesSpy = vi.fn();
    const freshWithdrawals: capella.Withdrawal[] = [
      {index: 1, validatorIndex: 2, address: new Uint8Array(20).fill(0x11), amount: 3n},
    ];
    const staleWithdrawals: capella.Withdrawal[] = [
      {index: 9, validatorIndex: 8, address: new Uint8Array(20).fill(0x22), amount: 7n},
    ];

    chainStub.emitter.on(routes.events.EventType.payloadAttributes, payloadAttributesSpy);
    getForkStub.mockReturnValue(ForkName.gloas);
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    chainStub.predictProposerHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getJustifiedBlock.mockReturnValue({
      executionPayloadBlockHash: zeroProtoBlock.blockRoot,
    } as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({
      executionPayloadBlockHash: zeroProtoBlock.blockRoot,
    } as ProtoBlock);
    forkChoiceStub.getBlockHexAndBlockHash.mockReturnValue({
      executionPayloadBlockHash: toRootHex(new Uint8Array(32).fill(0xaa)),
      executionPayloadNumber: 99,
    } as ProtoBlock);
    (forkChoiceStub as MockedBeaconChain["forkChoice"] & {shouldExtendPayload: Mock}).shouldExtendPayload = vi
      .fn()
      .mockReturnValue(true);
    updateBuilderStatus.mockReturnValue(void 0);

    const blockHash = new Uint8Array(32).fill(0xaa);
    const parentBlockHash = new Uint8Array(32).fill(0xbb);
    const state = {
      forkName: ForkName.gloas,
      slot: SLOTS_PER_EPOCH - 1,
      genesisTime: 0,
      epoch: 0,
      latestExecutionPayloadBid: {blockHash, parentBlockHash},
      payloadExpectedWithdrawals: staleWithdrawals,
      getExpectedWithdrawals: vi.fn().mockReturnValue({expectedWithdrawals: freshWithdrawals}),
      getRandaoMix: vi.fn().mockReturnValue(new Uint8Array(32).fill(0xdd)),
      getBeaconProposer: vi.fn().mockReturnValue(proposerIndex),
      hashTreeRoot: vi.fn().mockReturnValue(new Uint8Array(32)),
    };

    regenStub.getBlockSlotState.mockResolvedValue(state as never);
    beaconProposerCacheStub.get.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();
    executionEngineStub.notifyForkchoiceUpdate.mockResolvedValue("0x");

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledWith(
      ForkName.gloas,
      toRootHex(blockHash),
      zeroProtoBlock.blockRoot,
      zeroProtoBlock.blockRoot,
      expect.any(Object)
    );
    expect(payloadAttributesSpy).toHaveBeenCalledOnce();
    expect(payloadAttributesSpy).toHaveBeenCalledWith({
      version: ForkName.gloas,
      data: expect.objectContaining({
        parentBlockHash: blockHash,
        parentBlockNumber: 99,
        payloadAttributes: expect.objectContaining({withdrawals: freshWithdrawals}),
      }),
    });
    expect(state.getExpectedWithdrawals).toHaveBeenCalledTimes(2);
  });

  it("gloas - should emit payloadAttributes with parentBeaconBlockRoot aligned to updatedHeadRoot", async () => {
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    getForkStub.mockReturnValue(ForkName.gloas);

    const headRoot = toRootHex(new Uint8Array(32).fill(0x11));
    const proposerHeadRoot = toRootHex(new Uint8Array(32).fill(0x22));

    chainStub.recomputeForkChoiceHead.mockReturnValue({
      ...zeroProtoBlock,
      slot: SLOTS_PER_EPOCH - 3,
      blockRoot: headRoot,
    } as ProtoBlock);
    chainStub.predictProposerHead.mockReturnValue({
      ...zeroProtoBlock,
      slot: SLOTS_PER_EPOCH - 3,
      blockRoot: proposerHeadRoot,
    } as ProtoBlock);
    forkChoiceStub.getJustifiedBlock.mockReturnValue({
      executionPayloadBlockHash: zeroProtoBlock.blockRoot,
    } as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({
      executionPayloadBlockHash: zeroProtoBlock.blockRoot,
    } as ProtoBlock);
    (forkChoiceStub as MockedBeaconChain["forkChoice"] & {shouldExtendPayload: Mock}).shouldExtendPayload = vi
      .fn()
      .mockReturnValue(true);
    updateBuilderStatus.mockReturnValue(void 0);

    const blockHash = new Uint8Array(32).fill(0xaa);
    const parentBlockHash = new Uint8Array(32).fill(0xbb);
    (forkChoiceStub as MockedBeaconChain["forkChoice"] & {getBlockHexAndBlockHash: Mock}).getBlockHexAndBlockHash = vi
      .fn()
      .mockReturnValue({executionPayloadBlockHash: toRootHex(blockHash), executionPayloadNumber: 99});
    const state = {
      forkName: ForkName.gloas,
      slot: SLOTS_PER_EPOCH - 1,
      genesisTime: 0,
      epoch: 0,
      latestExecutionPayloadBid: {blockHash, parentBlockHash},
      payloadExpectedWithdrawals: [],
      getExpectedWithdrawals: vi.fn().mockReturnValue({expectedWithdrawals: []}),
      getRandaoMix: vi.fn().mockReturnValue(new Uint8Array(32).fill(0xdd)),
      getBeaconProposer: vi.fn().mockReturnValue(proposerIndex),
      hashTreeRoot: vi.fn().mockReturnValue(new Uint8Array(32)),
    };

    regenStub.getBlockSlotState.mockResolvedValue(state as never);
    beaconProposerCacheStub.get.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();
    executionEngineStub.notifyForkchoiceUpdate.mockResolvedValue("0x");

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0][0];
    expect(event.data.parentBlockRoot).toEqual(new Uint8Array(32).fill(0x22));
    expect(event.data.payloadAttributes.parentBeaconBlockRoot).toEqual(new Uint8Array(32).fill(0x22));
  });

  it("gloas - should prepare payload using latestExecutionPayloadBid.parentBlockHash when shouldExtendPayload is false", async () => {
    const payloadAttributesSpy = vi.fn();
    const freshWithdrawals: capella.Withdrawal[] = [
      {index: 1, validatorIndex: 2, address: new Uint8Array(20).fill(0x11), amount: 3n},
    ];
    const staleWithdrawals: capella.Withdrawal[] = [
      {index: 9, validatorIndex: 8, address: new Uint8Array(20).fill(0x22), amount: 7n},
    ];

    chainStub.emitter.on(routes.events.EventType.payloadAttributes, payloadAttributesSpy);
    getForkStub.mockReturnValue(ForkName.gloas);
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    chainStub.predictProposerHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getJustifiedBlock.mockReturnValue({
      executionPayloadBlockHash: zeroProtoBlock.blockRoot,
    } as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({
      executionPayloadBlockHash: zeroProtoBlock.blockRoot,
    } as ProtoBlock);
    forkChoiceStub.getBlockHexAndBlockHash.mockReturnValue({
      executionPayloadBlockHash: toRootHex(new Uint8Array(32).fill(0xbb)),
      executionPayloadNumber: 99,
    } as ProtoBlock);
    (forkChoiceStub as MockedBeaconChain["forkChoice"] & {shouldExtendPayload: Mock}).shouldExtendPayload = vi
      .fn()
      .mockReturnValue(false);
    updateBuilderStatus.mockReturnValue(void 0);

    const blockHash = new Uint8Array(32).fill(0xaa);
    const parentBlockHash = new Uint8Array(32).fill(0xbb);
    const state = {
      forkName: ForkName.gloas,
      slot: SLOTS_PER_EPOCH - 1,
      genesisTime: 0,
      epoch: 0,
      latestExecutionPayloadBid: {blockHash, parentBlockHash},
      payloadExpectedWithdrawals: staleWithdrawals,
      getExpectedWithdrawals: vi.fn().mockReturnValue({expectedWithdrawals: freshWithdrawals}),
      getRandaoMix: vi.fn().mockReturnValue(new Uint8Array(32).fill(0xdd)),
      getBeaconProposer: vi.fn().mockReturnValue(proposerIndex),
      hashTreeRoot: vi.fn().mockReturnValue(new Uint8Array(32)),
    };

    regenStub.getBlockSlotState.mockResolvedValue(state as never);
    beaconProposerCacheStub.get.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();
    executionEngineStub.notifyForkchoiceUpdate.mockResolvedValue("0x");

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledWith(
      ForkName.gloas,
      toRootHex(parentBlockHash),
      zeroProtoBlock.blockRoot,
      zeroProtoBlock.blockRoot,
      expect.any(Object)
    );
    expect(payloadAttributesSpy).toHaveBeenCalledOnce();
    expect(payloadAttributesSpy).toHaveBeenCalledWith({
      version: ForkName.gloas,
      data: expect.objectContaining({
        parentBlockHash,
        parentBlockNumber: 99,
        payloadAttributes: expect.objectContaining({withdrawals: staleWithdrawals}),
      }),
    });
    expect(state.getExpectedWithdrawals).not.toHaveBeenCalled();
  });
});
