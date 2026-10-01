import {Mock, MockInstance, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, computeTimeAtSlot} from "@lodestar/state-transition";
import {toHex, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineErrorCode} from "../../../src/chain/beaconEngine/interface.js";
import {IChainOptions} from "../../../src/chain/options.js";
import {PrepareNextSlotScheduler} from "../../../src/chain/prepareNextSlot.js";
import {BuilderStatus} from "../../../src/execution/builder/http.js";
import {PayloadIdCache} from "../../../src/execution/engine/payloadIdCache.js";
import {numToQuantity} from "../../../src/execution/engine/utils.js";
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

  it("bellatrix - should prepare payload and then emit SSE inside the engine", async () => {
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    getForkStub.mockReturnValue(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    chainStub.predictProposerHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
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
    expect(forkChoiceStub.getFinalizedBlock).toHaveBeenCalledOnce();
    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(executionEngineStub.notifyForkchoiceUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      spy.mock.invocationCallOrder[0]
    );
  });

  function prepareBellatrixProposer(): BeaconStateView {
    getForkStub.mockReturnValue(ForkName.bellatrix);
    const head = {...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3};
    chainStub.recomputeForkChoiceHead.mockReturnValue(head);
    chainStub.predictProposerHead.mockReturnValue(head);
    forkChoiceStub.getFinalizedBlock.mockReturnValue(zeroProtoBlock);
    const cachedState = generateCachedBellatrixState();
    vi.spyOn(cachedState.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);
    const state = new BeaconStateView(cachedState);
    regenStub.getBlockSlotState.mockResolvedValue(state);
    beaconProposerCacheStub.get.mockReturnValue("0x fee recipient address");
    executionEngineStub.payloadIdCache = new PayloadIdCache();
    return state;
  }

  it("returns a plain engine error and does not emit SSE after an EL failure", async () => {
    prepareBellatrixProposer();
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    executionEngineStub.notifyForkchoiceUpdate.mockRejectedValue(new Error("EL preparation failed"));
    const result = await chainStub.beaconEngine.prepareForNextSlot(SLOTS_PER_EPOCH - 2);
    expect(result).toEqual({
      ok: false,
      code: BeaconEngineErrorCode.INTERNAL,
      payload: {message: "EL preparation failed"},
    });
    expect(spy).not.toHaveBeenCalled();
    expect(updateBuilderStatus).toHaveBeenCalledOnce();
  });

  it("reuses the shared payload ID cache while still emitting SSE", async () => {
    const state = prepareBellatrixProposer();
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    executionEngineStub.payloadIdCache.add(
      {
        headBlockHash: toRootHex(state.latestExecutionPayloadHeader.blockHash),
        finalizedBlockHash: zeroProtoBlock.executionPayloadBlockHash ?? "0x" + "00".repeat(32),
        timestamp: numToQuantity(computeTimeAtSlot(config, state.slot, state.genesisTime)),
        prevRandao: toHex(state.getRandaoMix(state.epoch)),
        suggestedFeeRecipient: "0x fee recipient address",
      },
      "0x1234"
    );
    expect(await chainStub.beaconEngine.prepareForNextSlot(SLOTS_PER_EPOCH - 2)).toEqual({ok: true, data: null});
    expect(executionEngineStub.notifyForkchoiceUpdate).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("updates the engine-owned builder circuit breaker before checking builder status", async () => {
    prepareBellatrixProposer();
    Object.assign(chainStub.executionBuilder, {
      faultInspectionWindow: 8,
      allowedFaults: 1,
      status: BuilderStatus.circuitBreaker,
      updateStatus: vi.fn((status: BuilderStatus) => {
        chainStub.executionBuilder.status = status;
      }),
      checkStatus: vi.fn().mockResolvedValue(undefined),
    });
    updateBuilderStatus.mockImplementation((slot) =>
      BeaconEngine.prototype.updateBuilderStatus.call(chainStub.beaconEngine, slot)
    );
    forkChoiceStub.getSlotsPresent.mockReturnValue(8);
    await chainStub.beaconEngine.prepareForNextSlot(SLOTS_PER_EPOCH - 2);
    expect(chainStub.executionBuilder.status).toBe(BuilderStatus.enabled);
    expect(chainStub.executionBuilder.checkStatus).toHaveBeenCalledOnce();
    forkChoiceStub.getSlotsPresent.mockReturnValue(0);
    chainStub.executionBuilder.checkStatus.mockClear();
    await chainStub.beaconEngine.prepareForNextSlot(SLOTS_PER_EPOCH - 2);
    expect(chainStub.executionBuilder.status).toBe(BuilderStatus.circuitBreaker);
    expect(chainStub.executionBuilder.checkStatus).not.toHaveBeenCalled();
  });

  it("prunes DA only after a successful engine response", async () => {
    getForkStub.mockReturnValue(ForkName.gloas);
    const prune = vi.fn();
    Object.assign(chainStub.seenPayloadEnvelopeInputCache, {pruneBelowParent: prune});
    const prepare = vi
      .spyOn(chainStub.beaconEngine, "prepareForNextSlot")
      .mockResolvedValue({ok: true, data: {daPruneParent: zeroProtoBlock}});
    await Promise.all([scheduler.prepareForNextSlot(1), vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS)]);
    expect(prune).toHaveBeenCalledWith(zeroProtoBlock);
    prune.mockClear();
    prepare.mockResolvedValue({ok: false, code: BeaconEngineErrorCode.ABORTED, payload: {message: "aborted"}});
    await Promise.all([scheduler.prepareForNextSlot(2), vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS)]);
    expect(prune).not.toHaveBeenCalled();
    expect(loggerStub.error).not.toHaveBeenCalled();
  });
});
