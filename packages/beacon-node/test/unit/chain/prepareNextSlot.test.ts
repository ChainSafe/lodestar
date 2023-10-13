import {describe, it, expect, beforeEach, afterEach, vi, SpyInstance, Mock} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {routes} from "@lodestar/api";
import {ProtoBlock} from "@lodestar/fork-choice";
import {IChainOptions} from "../../../src/chain/options.js";
import {PrepareNextSlotScheduler} from "../../../src/chain/prepareNextSlot.js";
import {generateCachedBellatrixState} from "../../utils/state.js";
import {PayloadIdCache} from "../../../src/execution/engine/payloadIdCache.js";
import {zeroProtoBlock} from "../../utils/mocks/chain.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../__mocks__/mockedBeaconChain.js";
import {MockedLogger, getMockedLogger} from "../../__mocks__/loggerMock.js";

describe("PrepareNextSlot scheduler", () => {
  const abortController = new AbortController();

  let chainStub: MockedBeaconChain;
  let scheduler: PrepareNextSlotScheduler;
  let forkChoiceStub: MockedBeaconChain["forkChoice"];
  let regenStub: MockedBeaconChain["regen"];
  let loggerStub: MockedLogger;
  let beaconProposerCacheStub: MockedBeaconChain["beaconProposerCache"];
  let getForkStub: SpyInstance<[number], ForkName>;
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
      vi.advanceTimersByTimeAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalled();
    expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("pre bellatrix - should run regen.getBlockSlotState", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    (regenStub.getBlockSlotState as Mock).mockResolvedValue(undefined);
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalled();
    expect(regenStub.getBlockSlotState).toHaveBeenCalled();
  });

  it("pre bellatrix - should handle regen.getBlockSlotState error", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    regenStub.getBlockSlotState.mockRejectedValue("Unit test error");
    expect(loggerStub.error).not.toHaveBeenCalled();
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalled();
    expect(regenStub.getBlockSlotState).toHaveBeenCalled();
    expect(loggerStub.error).toHaveBeenCalledTimes(1);
  });

  it("bellatrix - should skip, headSlot is more than 1 epoch to prepare slot", async () => {
    getForkStub.mockReturnValue(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 2} as ProtoBlock);
    await Promise.all([
      scheduler.prepareForNextSlot(2 * SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalled();
    expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("bellatrix - should skip, no block proposer", async () => {
    getForkStub.mockReturnValue(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    const state = generateCachedBellatrixState();
    regenStub.getBlockSlotState.mockResolvedValue(state);
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalled();
    expect(regenStub.getBlockSlotState).toHaveBeenCalled();
  });

  it("bellatrix - should prepare payload", async () => {
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    getForkStub.mockReturnValue(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getJustifiedBlock.mockReturnValue({} as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({} as ProtoBlock);
    updateBuilderStatus.mockReturnValue(void 0);
    const state = generateCachedBellatrixState();
    vi.spyOn(state.epochCtx, "getBeaconProposer").mockReturnValue(proposerIndex);
    regenStub.getBlockSlotState.mockResolvedValue(state);
    beaconProposerCacheStub.get.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);

    expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalled();
    expect(regenStub.getBlockSlotState).toHaveBeenCalled();
    expect(updateBuilderStatus).toHaveBeenCalled();
    expect(forkChoiceStub.getJustifiedBlock).toHaveBeenCalled();
    expect(forkChoiceStub.getFinalizedBlock).toHaveBeenCalled();
    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
