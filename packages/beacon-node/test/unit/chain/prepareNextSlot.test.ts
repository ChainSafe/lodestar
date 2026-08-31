import {Mock, MockInstance, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
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
    forkChoiceStub.getConfirmedBlock.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
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
    expect(forkChoiceStub.getFinalizedBlock).toHaveBeenCalledTimes(2);
    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("post-fulu - should read proposer from head state and dial only the proposer head on reorg", async () => {
    getForkStub.mockReturnValue(ForkName.fulu);
    const headBlock = {...zeroProtoBlock, blockRoot: "0xhead", slot: SLOTS_PER_EPOCH - 3} as ProtoBlock;
    // predicted proposer-boost-reorg: build on the parent block instead of the canonical head
    const proposerHead = {...zeroProtoBlock, blockRoot: "0xparent", slot: SLOTS_PER_EPOCH - 4} as ProtoBlock;
    chainStub.recomputeForkChoiceHead.mockReturnValue(headBlock);
    chainStub.predictProposerHead.mockReturnValue(proposerHead);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({} as ProtoBlock);
    updateBuilderStatus.mockReturnValue(void 0);

    const headState = generateCachedBellatrixState();
    vi.spyOn(headState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);
    chainStub.getHeadState.mockReturnValue(new BeaconStateView(headState));
    regenStub.getBlockSlotState.mockResolvedValue(new BeaconStateView(generateCachedBellatrixState()));
    beaconProposerCacheStub.get.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    // proposer comes from the head state, so no dial is needed just to learn it
    expect(chainStub.getHeadState).toHaveBeenCalled();
    // a single dial, on the proposer head (reorg parent) - not two dials
    expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).toHaveBeenCalledWith(
      proposerHead,
      SLOTS_PER_EPOCH - 1,
      expect.anything(),
      expect.anything()
    );
  });

  it("gloas - should update builder circuit breaker and check builder api status ahead of the slot", async () => {
    // Anchor the fake clock to the start of clockSlot, else msFromSlot resolves against wall time
    // and the scheduled check collapses to a zero delay
    vi.setSystemTime((SLOTS_PER_EPOCH - 2) * config.SLOT_DURATION_MS);
    getForkStub.mockReturnValue(ForkName.gloas);
    const headBlock = {...zeroProtoBlock, blockRoot: "0xhead", slot: SLOTS_PER_EPOCH - 3} as ProtoBlock;
    const proposerHead = {...zeroProtoBlock, blockRoot: "0xparent", slot: SLOTS_PER_EPOCH - 4} as ProtoBlock;
    chainStub.recomputeForkChoiceHead.mockReturnValue(headBlock);
    chainStub.predictProposerHead.mockReturnValue(proposerHead);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({} as ProtoBlock);
    const state = generateCachedBellatrixState();
    vi.spyOn(state.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);
    // post-fulu (gloas): proposer is read from the head state, not from a dialed prepare state
    chainStub.getHeadState.mockReturnValue(new BeaconStateView(state));
    regenStub.getBlockSlotState.mockResolvedValue(new BeaconStateView(state));
    beaconProposerCacheStub.get.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    expect(chainStub.builderCircuitBreaker.update).toHaveBeenCalledWith(SLOTS_PER_EPOCH - 2, proposerHead);
    // The legacy pre-gloas builder status path stays untouched
    expect(updateBuilderStatus).not.toHaveBeenCalled();

    // Past PREPARE_NEXT_SLOT_BPS but before the check is due, an undelayed check would have run
    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS / 12);
    expect(chainStub.builderApiClient.checkStatus).not.toHaveBeenCalled();

    // Past BUILDER_STATUS_CHECK_BEFORE_SLOT_BPS, connections are warmed before bids are requested
    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS / 4);
    expect(chainStub.builderApiClient.checkStatus).toHaveBeenCalled();
  });
});
