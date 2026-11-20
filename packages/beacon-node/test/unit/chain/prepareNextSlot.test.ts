import {Mock, MockInstance, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  BeaconStateView,
  IBeaconStateViewGloas,
  createCachedBeaconState,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ForkchoiceCaller} from "../../../src/chain/forkChoice/index.js";
import {IChainOptions} from "../../../src/chain/options.js";
import {PrepareNextSlotScheduler} from "../../../src/chain/prepareNextSlot.js";
import {RegenCaller} from "../../../src/chain/regen/index.js";
import {PayloadIdCache} from "../../../src/execution/engine/payloadIdCache.js";
import {Clock, ClockEvent} from "../../../src/util/clock.js";
import {MockedLogger, getMockedLogger} from "../../mocks/loggerMock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {generateCachedBellatrixState, generateState, zeroProtoBlock} from "../../utils/state.js";

describe("PrepareNextSlot scheduler", () => {
  const abortController = new AbortController();

  let chainStub: MockedBeaconChain;
  let scheduler: PrepareNextSlotScheduler;
  let forkChoiceStub: MockedBeaconChain["forkChoice"];
  let regenStub: MockedBeaconChain["regen"];
  let loggerStub: MockedLogger;
  let beaconProposerCacheStub: MockedBeaconChain["beaconProposerCache"];
  let getForkStub: MockInstance<(_: number) => ForkName>;
  let optsStub: MockInstance<() => IChainOptions>;
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
    executionEngineStub.notifyForkchoiceUpdate.mockResolvedValue("0x1234");
    optsStub = vi.spyOn(chainStub, "opts", "get").mockReturnValue({emitPayloadAttributes} as IChainOptions);

    scheduler = new PrepareNextSlotScheduler(chainStub, config, null, loggerStub, abortController.signal);

    vi.spyOn(regenStub, "getBlockSlotState");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each([6000, 24000])(
    "prepares at the current slot offset when the next duration is %i ms",
    async (nextDuration) => {
      const clockSlot = 2 * SLOTS_PER_EPOCH - 1;
      // Anchor the fake clock to the start of clockSlot, else a wall time slot event from the real clock
      // can trigger an extra prepareForNextSlot within the test window
      vi.setSystemTime(clockSlot * config.SLOT_DURATION_MS);
      getForkStub.mockImplementation((slot) => (slot <= clockSlot ? ForkName.phase0 : ForkName.altair));
      vi.spyOn(config, "getSlotDurationMs").mockImplementation((fork) =>
        fork === ForkName.phase0 ? 12000 : nextDuration
      );
      chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: 0});

      const preparing = scheduler.prepareForNextSlot(clockSlot);
      await vi.advanceTimersByTimeAsync(7999);
      expect(chainStub.recomputeForkChoiceHead).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledOnce();
      await preparing;
    }
  );

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

  it("fulu - should prepare payload and emit payload attributes", async () => {
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    const computeStateHashTreeRoot = vi.spyOn(scheduler, "computeStateHashTreeRoot");
    getForkStub.mockReturnValue(ForkName.fulu);
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    chainStub.predictProposerHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getConfirmedBlock.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    updateBuilderStatus.mockReturnValue(void 0);
    forkChoiceStub.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: new Uint8Array(32),
      rootHex: zeroProtoBlock.blockRoot,
    });
    const fuluConfig = createBeaconConfig(getConfig(ForkName.fulu), new Uint8Array(32));
    const makeState = (slot: number) =>
      new BeaconStateView(
        createCachedBeaconState(generateState({slot}, fuluConfig, true), {config: fuluConfig, pubkeyCache})
      );
    const headState = makeState(SLOTS_PER_EPOCH - 3);
    vi.spyOn(headState, "getBeaconProposer").mockReturnValue(proposerIndex);
    chainStub.getHeadState.mockReturnValue(headState);
    regenStub.getBlockSlotState.mockResolvedValue(makeState(SLOTS_PER_EPOCH - 1));
    beaconProposerCacheStub.has.mockReturnValue(true);
    beaconProposerCacheStub.getOrDefault.mockReturnValue("0x fee recipient address");
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
    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledWith(
      ForkName.fulu,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({withdrawals: [], parentBeaconBlockRoot: expect.any(Uint8Array)})
    );
    expect(spy).toHaveBeenCalledTimes(1);
    // payload_attributes must not wait on the EL round trip or the state root warm-up
    expect(spy.mock.invocationCallOrder[0]).toBeLessThan(
      executionEngineStub.notifyForkchoiceUpdate.mock.invocationCallOrder[0]
    );
    expect(spy.mock.invocationCallOrder[0]).toBeLessThan(computeStateHashTreeRoot.mock.invocationCallOrder[0]);
    // attributes computed for the event are reused for the EL payload preparation
    expect(executionEngineStub.notifyForkchoiceUpdate.mock.calls[0][5]).toBe(
      spy.mock.calls[0][0].data.payloadAttributes
    );
    expect(loggerStub.error).not.toHaveBeenCalled();
  });

  it("gloas - should emit payload attributes with the forkchoice hashes sent to the execution layer", async () => {
    const safeBlockHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const finalizedBlockHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    getForkStub.mockReturnValue(ForkName.gloas);
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    chainStub.predictProposerHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getConfirmedBlock.mockReturnValue({
      ...zeroProtoBlock,
      slot: SLOTS_PER_EPOCH - 3,
      parentBlockHash: safeBlockHash,
    } as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({
      ...zeroProtoBlock,
      slot: SLOTS_PER_EPOCH - 3,
      parentBlockHash: finalizedBlockHash,
    } as ProtoBlock);
    forkChoiceStub.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: new Uint8Array(32),
      rootHex: zeroProtoBlock.blockRoot,
    });
    forkChoiceStub.getBlockHexDefaultStatus.mockReturnValue(null);
    forkChoiceStub.getBlockHexAndBlockHash.mockReturnValue({
      ...zeroProtoBlock,
      executionPayloadBlockHash: zeroProtoBlock.blockRoot,
      executionPayloadGasLimit: 30_000_000,
    } as ProtoBlock);
    const gloasConfig = createBeaconConfig(getConfig(ForkName.gloas), new Uint8Array(32));
    const makeState = (slot: number) =>
      new BeaconStateView(
        createCachedBeaconState(generateState({slot}, gloasConfig, true), {config: gloasConfig, pubkeyCache})
      );
    const headState = makeState(SLOTS_PER_EPOCH - 3);
    vi.spyOn(headState, "getBeaconProposer").mockReturnValue(proposerIndex);
    chainStub.getHeadState.mockReturnValue(headState);
    regenStub.getBlockSlotState.mockResolvedValue(makeState(SLOTS_PER_EPOCH - 1));
    beaconProposerCacheStub.has.mockReturnValue(true);
    beaconProposerCacheStub.getOrDefault.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      version: ForkName.gloas,
      data: {safeBlockHash: fromHex(safeBlockHash), finalizedBlockHash: fromHex(finalizedBlockHash)},
    });
    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledWith(
      ForkName.gloas,
      expect.any(String),
      expect.any(String),
      safeBlockHash,
      finalizedBlockHash,
      spy.mock.calls[0][0].data.payloadAttributes
    );
    expect(loggerStub.error).not.toHaveBeenCalled();
  });

  it("gloas - should prepare the payload with the fee recipient and gas limit of the pooled proposer preferences", async () => {
    const pooledFeeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    getForkStub.mockReturnValue(ForkName.gloas);
    const head = {
      ...zeroProtoBlock,
      slot: SLOTS_PER_EPOCH - 3,
      parentBlockHash: zeroProtoBlock.blockRoot,
    } as ProtoBlock;
    chainStub.recomputeForkChoiceHead.mockReturnValue(head);
    chainStub.predictProposerHead.mockReturnValue(head);
    forkChoiceStub.getConfirmedBlock.mockReturnValue(head);
    forkChoiceStub.getFinalizedBlock.mockReturnValue(head);
    forkChoiceStub.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: new Uint8Array(32),
      rootHex: zeroProtoBlock.blockRoot,
    });
    forkChoiceStub.getBlockHexDefaultStatus.mockReturnValue(head);
    forkChoiceStub.getDependentRoot.mockReturnValue(zeroProtoBlock.blockRoot);
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.feeRecipient = fromHex(pooledFeeRecipient);
    preferences.message.targetGasLimit = 60_000_000n;
    vi.mocked(chainStub.proposerPreferencesPool.get).mockReturnValue(preferences);
    const gloasConfig = createBeaconConfig(getConfig(ForkName.gloas), new Uint8Array(32));
    const makeState = (slot: number) =>
      new BeaconStateView(
        createCachedBeaconState(generateState({slot}, gloasConfig, true), {config: gloasConfig, pubkeyCache})
      );
    const headState = makeState(SLOTS_PER_EPOCH - 3);
    vi.spyOn(headState, "getBeaconProposer").mockReturnValue(proposerIndex);
    chainStub.getHeadState.mockReturnValue(headState);
    regenStub.getBlockSlotState.mockResolvedValue(makeState(SLOTS_PER_EPOCH - 1));
    beaconProposerCacheStub.has.mockReturnValue(true);
    beaconProposerCacheStub.getOrDefault.mockReturnValue("0x fee recipient address");
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    expect(chainStub.proposerPreferencesPool.get).toHaveBeenCalledWith(SLOTS_PER_EPOCH - 1, zeroProtoBlock.blockRoot);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].data.payloadAttributes).toMatchObject({
      suggestedFeeRecipient: pooledFeeRecipient,
      targetGasLimit: 60_000_000n,
    });
    expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledWith(
      ForkName.gloas,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({suggestedFeeRecipient: pooledFeeRecipient})
    );
    expect(loggerStub.error).not.toHaveBeenCalled();
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
    beaconProposerCacheStub.has.mockReturnValue(true);
    beaconProposerCacheStub.getOrDefault.mockReturnValue("0x fee recipient address");
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
    beaconProposerCacheStub.has.mockReturnValue(true);
    beaconProposerCacheStub.getOrDefault.mockReturnValue("0x fee recipient address");
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

  describe("early payload attributes", () => {
    const clockSlot = SLOTS_PER_EPOCH - 3;
    const prepareSlot = clockSlot + 1;
    const headRoot = `0x${"aa".repeat(32)}`;
    // The head bid extends parentPayloadHash and commits to payloadHash
    const parentPayloadHash = `0x${"bb".repeat(32)}`;
    const payloadHash = `0x${"cc".repeat(32)}`;
    const safeBlockHash = `0x${"dd".repeat(32)}`;
    const finalizedBlockHash = `0x${"ee".repeat(32)}`;
    const earlyOpts = {emitPayloadAttributes: true, emitPayloadAttributesEarly: true} as IChainOptions;
    const gloasConfig = createBeaconConfig(getConfig(ForkName.gloas), new Uint8Array(32));
    const emptyParentWithdrawal = {...ssz.capella.Withdrawal.defaultValue(), index: 7, validatorIndex: 3, amount: 11n};

    let earlyController: AbortController;
    let earlyScheduler: PrepareNextSlotScheduler;
    let payloadAttributesSpy: Mock;
    let prepareState: IBeaconStateViewGloas;

    function makeHead(payloadStatus: PayloadStatus, blockRoot = headRoot): ProtoBlock {
      return {
        ...zeroProtoBlock,
        slot: clockSlot,
        blockRoot,
        payloadStatus,
        parentBlockHash: parentPayloadHash,
        executionStatus: ExecutionStatus.Valid,
        executionPayloadBlockHash: payloadStatus === PayloadStatus.FULL ? payloadHash : parentPayloadHash,
        executionPayloadNumber: 1,
        executionPayloadGasLimit: 30_000_000,
      } as ProtoBlock;
    }

    function makeState(slot: number, parentPayloadApplied = false): IBeaconStateViewGloas {
      const state = generateState(
        {
          slot,
          latestExecutionPayloadBid: {
            ...ssz.gloas.ExecutionPayloadBid.defaultValue(),
            parentBlockHash: fromHex(parentPayloadHash),
            blockHash: fromHex(payloadHash),
          },
          latestBlockHash: fromHex(parentPayloadApplied ? payloadHash : parentPayloadHash),
          payloadExpectedWithdrawals: parentPayloadApplied ? [] : [emptyParentWithdrawal],
        },
        gloasConfig,
        true
      );
      state.blockRoots.set(slot - 1, fromHex(headRoot));
      const stateView = new BeaconStateView(createCachedBeaconState(state, {config: gloasConfig, pubkeyCache}));
      if (!isStatePostGloas(stateView)) {
        throw new Error("Expected Gloas state");
      }
      return stateView;
    }

    function createEarlyScheduler(opts = earlyOpts): PrepareNextSlotScheduler {
      optsStub.mockReturnValue(opts);
      return new PrepareNextSlotScheduler(chainStub, config, null, loggerStub, earlyController.signal);
    }

    function emitBlockImported(slot = clockSlot, block = headRoot): void {
      chainStub.emitter.emit(routes.events.EventType.block, {slot, block, executionOptimistic: false});
    }

    function emitExecutionPayloadImported(slot = clockSlot, blockRoot = headRoot): void {
      chainStub.emitter.emit(routes.events.EventType.executionPayload, {
        slot,
        blockRoot,
        blockHash: payloadHash,
        builderIndex: 0,
        executionOptimistic: false,
      });
    }

    /** The early path only awaits mocked promises, one real macrotask turn drains all of them */
    async function flushEarlyWork(): Promise<void> {
      await vi.advanceTimersByTimeAsync(0);
    }

    function subscribeAlternates(alternate: Mock): void {
      chainStub.emitter.off(routes.events.EventType.payloadAttributes, payloadAttributesSpy);
      chainStub.emitter.on(routes.events.EventType.payloadAttributes, (event) => {
        if (event.context?.role === "alternate") alternate(event);
        else payloadAttributesSpy(event);
      });
    }

    function makeHeadFullOnRecompute(): void {
      chainStub.recomputeForkChoiceHead.mockImplementation(() => {
        const fullHead = makeHead(PayloadStatus.FULL);
        forkChoiceStub.getHead.mockReturnValue(fullHead);
        return fullHead;
      });
    }

    beforeEach(() => {
      vi.setSystemTime(clockSlot * config.SLOT_DURATION_MS);
      earlyController = new AbortController();
      getForkStub.mockReturnValue(ForkName.gloas);
      forkChoiceStub.getHead.mockReturnValue(makeHead(PayloadStatus.EMPTY));
      forkChoiceStub.shouldBuildOnFull.mockImplementation((head) => head.payloadStatus === PayloadStatus.FULL);
      forkChoiceStub.getConfirmedBlock.mockReturnValue({
        ...zeroProtoBlock,
        parentBlockHash: safeBlockHash,
      } as ProtoBlock);
      forkChoiceStub.getFinalizedBlock.mockReturnValue({
        ...zeroProtoBlock,
        parentBlockHash: finalizedBlockHash,
      } as ProtoBlock);
      forkChoiceStub.getFinalizedCheckpoint.mockReturnValue({
        epoch: 0,
        root: new Uint8Array(32),
        rootHex: zeroProtoBlock.blockRoot,
      });
      forkChoiceStub.getBlockHexDefaultStatus.mockReturnValue(null);
      forkChoiceStub.getBlockHexAndBlockHash.mockReturnValue(makeHead(PayloadStatus.FULL));
      prepareState = makeState(prepareSlot);
      vi.spyOn(prepareState, "withParentPayloadApplied").mockReturnValue(makeState(prepareSlot, true));
      regenStub.getBlockSlotState.mockResolvedValue(prepareState);
      chainStub.getParentExecutionRequests.mockResolvedValue(ssz.gloas.ExecutionRequests.defaultValue());
      payloadAttributesSpy = vi.fn();
      chainStub.emitter.on(routes.events.EventType.payloadAttributes, payloadAttributesSpy);
      earlyScheduler = createEarlyScheduler();
    });

    afterEach(() => {
      earlyController.abort();
    });

    it("should not subscribe to import events unless both flags are set", async () => {
      earlyController.abort();
      expect(chainStub.emitter.listenerCount(routes.events.EventType.block)).toBe(0);
      expect(chainStub.emitter.listenerCount(routes.events.EventType.executionPayload)).toBe(0);

      earlyController = new AbortController();
      createEarlyScheduler({emitPayloadAttributesEarly: true} as IChainOptions);
      expect(chainStub.emitter.listenerCount(routes.events.EventType.block)).toBe(0);
      expect(chainStub.emitter.listenerCount(routes.events.EventType.executionPayload)).toBe(0);

      // The default scheduler from the outer setup runs with the early flag off
      emitBlockImported();
      emitExecutionPayloadImported();
      await flushEarlyWork();
      expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
      expect(payloadAttributesSpy).not.toHaveBeenCalled();
    });

    it("should emit the empty tuple on block import and the full tuple on payload import", async () => {
      const computeStateHashTreeRoot = vi.spyOn(earlyScheduler, "computeStateHashTreeRoot");

      emitBlockImported();
      await flushEarlyWork();

      expect(regenStub.getBlockSlotState).toHaveBeenCalledExactlyOnceWith(
        forkChoiceStub.getHead(),
        prepareSlot,
        {dontTransferCache: true},
        RegenCaller.prepareEarlyPayloadAttributes
      );
      expect(payloadAttributesSpy).toHaveBeenCalledTimes(1);
      expect(payloadAttributesSpy.mock.calls[0][0]).toMatchObject({
        version: ForkName.gloas,
        data: {
          proposalSlot: prepareSlot,
          parentBlockRoot: fromHex(headRoot),
          parentBlockHash: fromHex(parentPayloadHash),
          safeBlockHash: fromHex(safeBlockHash),
          finalizedBlockHash: fromHex(finalizedBlockHash),
          payloadAttributes: {slotNumber: prepareSlot, withdrawals: [emptyParentWithdrawal]},
        },
      });
      // Block import already recomputed the head and the regular run owns the EL and cache work
      expect(chainStub.recomputeForkChoiceHead).not.toHaveBeenCalled();
      expect(chainStub.getParentExecutionRequests).not.toHaveBeenCalled();
      expect(executionEngineStub.notifyForkchoiceUpdate).not.toHaveBeenCalled();
      expect(chainStub.builderCircuitBreaker.update).not.toHaveBeenCalled();
      expect(chainStub.builderApiClient.checkStatus).not.toHaveBeenCalled();
      expect(computeStateHashTreeRoot).not.toHaveBeenCalled();

      makeHeadFullOnRecompute();
      emitExecutionPayloadImported();
      await flushEarlyWork();

      expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledExactlyOnceWith(
        ForkchoiceCaller.prepareEarlyPayloadAttributes
      );
      expect(chainStub.getParentExecutionRequests).toHaveBeenCalledExactlyOnceWith(clockSlot, headRoot);
      expect(prepareState.withParentPayloadApplied).toHaveBeenCalledExactlyOnceWith(
        ssz.gloas.ExecutionRequests.defaultValue()
      );
      expect(payloadAttributesSpy).toHaveBeenCalledTimes(2);
      expect(payloadAttributesSpy.mock.calls[1][0]).toMatchObject({
        version: ForkName.gloas,
        data: {
          proposalSlot: prepareSlot,
          parentBlockRoot: fromHex(headRoot),
          parentBlockHash: fromHex(payloadHash),
          payloadAttributes: {slotNumber: prepareSlot, withdrawals: []},
        },
      });
      expect(executionEngineStub.notifyForkchoiceUpdate).not.toHaveBeenCalled();
      expect(loggerStub.error).not.toHaveBeenCalled();
    });

    it.each(["early", "regular", "missed-slot fallback"] as const)(
      "emits the authoritative %s event before queued alternate work",
      async (mode) => {
        earlyController.abort();
        earlyController = new AbortController();
        earlyScheduler = createEarlyScheduler({
          ...earlyOpts,
          emitPayloadAttributesAlternates: true,
          payloadAttributesAlternateBuilderIndices: [0],
        });
        const alternate = vi.fn();
        subscribeAlternates(alternate);
        const headSlot = mode === "missed-slot fallback" ? clockSlot - 1 : clockSlot;
        forkChoiceStub.getHead.mockReturnValue({...makeHead(PayloadStatus.EMPTY), slot: headSlot});
        forkChoiceStub.getBlockHex.mockImplementation((root, status) =>
          root === headRoot ? {...makeHead(status), slot: headSlot} : null
        );
        forkChoiceStub.getDependentRoot.mockReturnValue(headRoot);
        chainStub.getHeadState.mockReturnValue(prepareState);
        chainStub.recomputeForkChoiceHead.mockImplementation(() => forkChoiceStub.getHead());
        let finish: ((requests: ReturnType<typeof ssz.gloas.ExecutionRequests.defaultValue>) => void) | undefined;
        chainStub.getParentExecutionRequests.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        );

        if (mode === "early") {
          emitBlockImported();
          await vi.advanceTimersByTimeAsync(20);
        } else if (mode === "missed-slot fallback") {
          chainStub.clock.emit(ClockEvent.slot, clockSlot);
          await vi.advanceTimersByTimeAsync(config.getSlotComponentDurationMs(ForkName.gloas, 1667) + 20);
        } else {
          const regular = earlyScheduler.prepareForNextSlot(clockSlot);
          await vi.advanceTimersByTimeAsync(config.getSlotComponentDurationMs(ForkName.gloas, 6667) + 20);
          await regular;
        }

        expect(payloadAttributesSpy).toHaveBeenCalledOnce();
        expect(alternate).not.toHaveBeenCalled();
        expect(finish).toBeDefined();
        expect(chainStub.getParentExecutionRequests).toHaveBeenCalledExactlyOnceWith(headSlot, headRoot);
        finish?.(ssz.gloas.ExecutionRequests.defaultValue());
        await vi.advanceTimersByTimeAsync(20);
        expect(alternate).toHaveBeenCalledOnce();
        expect(alternate.mock.calls[0][0].data.parentBlockHash).toEqual(fromHex(payloadHash));
        expect(payloadAttributesSpy.mock.invocationCallOrder[0]).toBeLessThan(alternate.mock.invocationCallOrder[0]);
        expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
        expect(executionEngineStub.notifyForkchoiceUpdate).not.toHaveBeenCalled();
      }
    );

    it("starts alternate work after the primary event without waiting for the regular FCU", async () => {
      earlyController.abort();
      earlyController = new AbortController();
      earlyScheduler = createEarlyScheduler({
        ...earlyOpts,
        emitPayloadAttributesAlternates: true,
        payloadAttributesAlternateBuilderIndices: [0],
      });
      const alternate = vi.fn();
      subscribeAlternates(alternate);
      forkChoiceStub.getBlockHex.mockImplementation((root, status) => (root === headRoot ? makeHead(status) : null));
      forkChoiceStub.getDependentRoot.mockReturnValue(headRoot);
      chainStub.getHeadState.mockReturnValue(prepareState);
      chainStub.recomputeForkChoiceHead.mockImplementation(() => forkChoiceStub.getHead());
      chainStub.predictProposerHead.mockImplementation(() => forkChoiceStub.getHead());
      beaconProposerCacheStub.has.mockReturnValue(true);
      beaconProposerCacheStub.getOrDefault.mockReturnValue(`0x${"11".repeat(20)}`);
      (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();
      let finish: ((payloadId: string) => void) | undefined;
      executionEngineStub.notifyForkchoiceUpdate.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      let completed = false;
      const regular = earlyScheduler.prepareForNextSlot(clockSlot).then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(config.getSlotComponentDurationMs(ForkName.gloas, 6667) + 20);
      expect(finish).toBeDefined();
      expect(completed).toBe(false);
      expect(payloadAttributesSpy).toHaveBeenCalledOnce();
      expect(alternate).toHaveBeenCalledOnce();
      expect(payloadAttributesSpy.mock.invocationCallOrder[0]).toBeLessThan(alternate.mock.invocationCallOrder[0]);
      finish?.("0x1234");
      await regular;
      expect(loggerStub.error).not.toHaveBeenCalled();
    });

    it("should emit each tuple once for duplicate and coalesced import events", async () => {
      emitBlockImported();
      emitBlockImported();
      await flushEarlyWork();
      expect(payloadAttributesSpy).toHaveBeenCalledTimes(1);

      // A payload import coalesced behind a running block trigger still flips the head to full
      makeHeadFullOnRecompute();
      emitBlockImported();
      emitExecutionPayloadImported();
      emitExecutionPayloadImported();
      await flushEarlyWork();

      expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledTimes(1);
      expect(payloadAttributesSpy).toHaveBeenCalledTimes(2);
      expect(payloadAttributesSpy.mock.calls[1][0].data.parentBlockHash).toEqual(fromHex(payloadHash));
      expect(loggerStub.error).not.toHaveBeenCalled();
    });

    it("should ignore import events for another slot or a non-head block", async () => {
      emitBlockImported(clockSlot - 1);
      emitBlockImported(clockSlot + 1);
      emitExecutionPayloadImported(clockSlot - 1);
      emitBlockImported(clockSlot, `0x${"ff".repeat(32)}`);
      emitExecutionPayloadImported(clockSlot, `0x${"ff".repeat(32)}`);
      await flushEarlyWork();

      // A non-head payload import must not trigger a fork choice recompute either
      expect(chainStub.recomputeForkChoiceHead).not.toHaveBeenCalled();
      expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
      expect(payloadAttributesSpy).not.toHaveBeenCalled();
      expect(loggerStub.error).not.toHaveBeenCalled();
    });

    it("should skip a pending head", async () => {
      forkChoiceStub.getHead.mockReturnValue(makeHead(PayloadStatus.PENDING));

      emitBlockImported();
      await flushEarlyWork();

      expect(forkChoiceStub.shouldBuildOnFull).not.toHaveBeenCalled();
      expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
      expect(payloadAttributesSpy).not.toHaveBeenCalled();
      expect(loggerStub.error).not.toHaveBeenCalled();
    });

    it("should leave epoch transitions to the regular run", async () => {
      const lastSlotOfEpoch = SLOTS_PER_EPOCH - 1;
      vi.setSystemTime(lastSlotOfEpoch * config.SLOT_DURATION_MS);
      forkChoiceStub.getHead.mockReturnValue({...makeHead(PayloadStatus.EMPTY), slot: lastSlotOfEpoch});

      emitBlockImported(lastSlotOfEpoch);
      emitExecutionPayloadImported(lastSlotOfEpoch);
      await flushEarlyWork();

      expect(chainStub.recomputeForkChoiceHead).not.toHaveBeenCalled();
      expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
      expect(payloadAttributesSpy).not.toHaveBeenCalled();
    });

    describe("missed-slot fallback", () => {
      const grace = config.getSlotComponentDurationMs(ForkName.gloas, 1667);

      function setPreviousHead(payloadStatus = PayloadStatus.FULL, slot = clockSlot - 1): ProtoBlock {
        const head = {...makeHead(payloadStatus), slot};
        forkChoiceStub.getHead.mockReturnValue(head);
        chainStub.recomputeForkChoiceHead.mockImplementation(() => forkChoiceStub.getHead());
        return head;
      }

      it("should start on the previous full head after the grace period without an import", async () => {
        const head = setPreviousHead();
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        await vi.advanceTimersByTimeAsync(grace - 1);
        expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);

        expect(regenStub.getBlockSlotState).toHaveBeenCalledExactlyOnceWith(
          head,
          prepareSlot,
          {dontTransferCache: true},
          RegenCaller.prepareEarlyPayloadAttributes
        );
        expect(chainStub.getParentExecutionRequests).toHaveBeenCalledExactlyOnceWith(clockSlot - 1, headRoot);
        expect(payloadAttributesSpy).toHaveBeenCalledExactlyOnceWith({
          version: ForkName.gloas,
          data: expect.objectContaining({
            proposalSlot: prepareSlot,
            parentBlockRoot: fromHex(headRoot),
            parentBlockHash: fromHex(payloadHash),
            payloadAttributes: expect.objectContaining({slotNumber: prepareSlot, withdrawals: []}),
          }),
        });
        expect(executionEngineStub.notifyForkchoiceUpdate).not.toHaveBeenCalled();
      });

      it("should let an imported current-slot block supersede the fallback before it fires", async () => {
        setPreviousHead();
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        forkChoiceStub.getHead.mockReturnValue(makeHead(PayloadStatus.EMPTY));
        emitBlockImported();
        await flushEarlyWork();
        await vi.advanceTimersByTimeAsync(grace);

        expect(regenStub.getBlockSlotState).toHaveBeenCalledTimes(1);
        expect(payloadAttributesSpy).toHaveBeenCalledTimes(1);
        expect(chainStub.recomputeForkChoiceHead).not.toHaveBeenCalled();
      });

      it("should replace an in-flight fallback when a current-slot block arrives", async () => {
        setPreviousHead();
        let resolveRegen: (state: IBeaconStateViewGloas) => void = () => {};
        regenStub.getBlockSlotState.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveRegen = resolve;
            })
        );
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        await vi.advanceTimersByTimeAsync(grace);
        const currentRoot = `0x${"ff".repeat(32)}`;
        forkChoiceStub.getHead.mockReturnValue(makeHead(PayloadStatus.EMPTY, currentRoot));
        emitBlockImported(clockSlot, currentRoot);
        resolveRegen(prepareState);
        await flushEarlyWork();

        expect(regenStub.getBlockSlotState).toHaveBeenCalledTimes(2);
        expect(payloadAttributesSpy).toHaveBeenCalledTimes(1);
        expect(payloadAttributesSpy.mock.calls[0][0].data.parentBlockRoot).toEqual(fromHex(currentRoot));
      });

      it("should not use a pending previous payload", async () => {
        setPreviousHead(PayloadStatus.PENDING);
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        await vi.advanceTimersByTimeAsync(grace);

        expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
        expect(payloadAttributesSpy).not.toHaveBeenCalled();
      });

      it("should leave an old head across an epoch boundary to the regular run", async () => {
        const nextEpochSlot = SLOTS_PER_EPOCH + 1;
        vi.setSystemTime(nextEpochSlot * config.SLOT_DURATION_MS);
        setPreviousHead(PayloadStatus.FULL, SLOTS_PER_EPOCH - 1);
        chainStub.clock.emit(ClockEvent.slot, nextEpochSlot);
        await vi.advanceTimersByTimeAsync(grace);

        expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
        expect(payloadAttributesSpy).not.toHaveBeenCalled();
      });

      it("should not regenerate without a subscriber", async () => {
        setPreviousHead();
        chainStub.emitter.off(routes.events.EventType.payloadAttributes, payloadAttributesSpy);
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        await vi.advanceTimersByTimeAsync(grace);

        expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
      });

      it("should preserve slot notification order while the clock catches up", async () => {
        earlyController.abort();
        earlyController = new AbortController();
        Object.defineProperty(chainStub, "clock", {
          value: new Clock({config, genesisTime: 0, signal: earlyController.signal}),
        });
        earlyScheduler = createEarlyScheduler();
        const seen: number[] = [];
        const start = chainStub.clock.currentSlot;
        chainStub.clock.on(ClockEvent.slot, (slot) => seen.push(slot));
        vi.setSystemTime((start + 3) * config.SLOT_DURATION_MS);

        expect(chainStub.clock.currentSlot).toBe(start + 3);
        expect(seen).toEqual([start + 1, start + 2, start + 3]);
        expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
      });

      it("should admit a subscriber that connects during the grace period", async () => {
        setPreviousHead();
        chainStub.emitter.off(routes.events.EventType.payloadAttributes, payloadAttributesSpy);
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        await vi.advanceTimersByTimeAsync(grace / 2);
        chainStub.emitter.on(routes.events.EventType.payloadAttributes, payloadAttributesSpy);
        await vi.advanceTimersByTimeAsync(grace / 2);

        expect(payloadAttributesSpy).toHaveBeenCalledTimes(1);
      });

      it("should use a different old head selected by recomputation", async () => {
        setPreviousHead();
        const newRoot = `0x${"fa".repeat(32)}`;
        chainStub.recomputeForkChoiceHead.mockImplementation(() => {
          const head = {...makeHead(PayloadStatus.EMPTY, newRoot), slot: clockSlot - 1};
          forkChoiceStub.getHead.mockReturnValue(head);
          return head;
        });
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        await vi.advanceTimersByTimeAsync(grace);

        expect(payloadAttributesSpy).toHaveBeenCalledTimes(1);
        expect(payloadAttributesSpy.mock.calls[0][0].data.parentBlockRoot).toEqual(fromHex(newRoot));
      });

      it("should cancel its clock subscription and pending fallback on shutdown", async () => {
        setPreviousHead();
        const listeners = chainStub.clock.listenerCount(ClockEvent.slot);
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        earlyController.abort();
        await vi.advanceTimersByTimeAsync(grace);

        expect(chainStub.clock.listenerCount(ClockEvent.slot)).toBe(listeners - 2);
        expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
        expect(payloadAttributesSpy).not.toHaveBeenCalled();
        expect(loggerStub.error).not.toHaveBeenCalled();
      });

      it("should leave an overdue clock notification to the regular run", async () => {
        setPreviousHead();
        vi.setSystemTime(clockSlot * config.SLOT_DURATION_MS + grace + 1);
        chainStub.clock.emit(ClockEvent.slot, clockSlot);
        await flushEarlyWork();
        expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
      });

      it.each([PayloadStatus.EMPTY, PayloadStatus.FULL])(
        "should emit the same attributes as the regular run for a missed-slot %s head",
        async (status) => {
          setPreviousHead(status);
          chainStub.getHeadState.mockReturnValue(makeState(clockSlot));
          chainStub.clock.emit(ClockEvent.slot, clockSlot);
          await vi.advanceTimersByTimeAsync(grace);
          expect(payloadAttributesSpy).toHaveBeenCalledTimes(1);
          const first = payloadAttributesSpy.mock.calls[0][0];
          await vi.advanceTimersByTimeAsync(config.getSlotComponentDurationMs(ForkName.gloas, 6667) - grace);
          expect(payloadAttributesSpy.mock.calls.length).toBeGreaterThan(1);
          for (const [event] of payloadAttributesSpy.mock.calls.slice(1)) expect(event).toEqual(first);
          expect(loggerStub.error).not.toHaveBeenCalled();
        }
      );
    });

    it("should not regenerate without payload attributes listeners", async () => {
      chainStub.emitter.off(routes.events.EventType.payloadAttributes, payloadAttributesSpy);

      emitBlockImported();
      await flushEarlyWork();

      expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
      expect(payloadAttributesSpy).not.toHaveBeenCalled();
    });

    it("should drop stale work when the clock slot moves on during regen", async () => {
      regenStub.getBlockSlotState.mockImplementation(async () => {
        vi.setSystemTime((clockSlot + 1) * config.SLOT_DURATION_MS);
        return prepareState;
      });

      emitBlockImported();
      await flushEarlyWork();

      expect(regenStub.getBlockSlotState).toHaveBeenCalledTimes(1);
      expect(payloadAttributesSpy).not.toHaveBeenCalled();
      expect(loggerStub.error).not.toHaveBeenCalled();
    });

    it("should drop stale work when the head changes during regen", async () => {
      const otherRoot = `0x${"ff".repeat(32)}`;
      regenStub.getBlockSlotState.mockImplementation(async () => {
        forkChoiceStub.getHead.mockReturnValue(makeHead(PayloadStatus.EMPTY, otherRoot));
        return prepareState;
      });

      emitBlockImported();
      await flushEarlyWork();

      expect(regenStub.getBlockSlotState).toHaveBeenCalledTimes(1);
      expect(payloadAttributesSpy).not.toHaveBeenCalled();
      expect(loggerStub.error).not.toHaveBeenCalled();
    });

    it("should drop stale work and unsubscribe on shutdown", async () => {
      let resolveRegen: (state: IBeaconStateViewGloas) => void = () => {};
      regenStub.getBlockSlotState.mockImplementation(
        () =>
          new Promise<IBeaconStateViewGloas>((resolve) => {
            resolveRegen = resolve;
          })
      );

      emitBlockImported();
      await flushEarlyWork();
      expect(regenStub.getBlockSlotState).toHaveBeenCalledTimes(1);

      earlyController.abort();
      resolveRegen(prepareState);
      await flushEarlyWork();

      expect(payloadAttributesSpy).not.toHaveBeenCalled();
      expect(loggerStub.error).not.toHaveBeenCalled();
      expect(chainStub.emitter.listenerCount(routes.events.EventType.block)).toBe(0);
      expect(chainStub.emitter.listenerCount(routes.events.EventType.executionPayload)).toBe(0);
      emitBlockImported();
      await flushEarlyWork();
      expect(regenStub.getBlockSlotState).toHaveBeenCalledTimes(1);
    });

    it("should keep the regular run emitting after an early emission", async () => {
      emitBlockImported();
      await flushEarlyWork();
      expect(payloadAttributesSpy).toHaveBeenCalledTimes(1);

      chainStub.recomputeForkChoiceHead.mockReturnValue(makeHead(PayloadStatus.EMPTY));
      chainStub.getHeadState.mockReturnValue(makeState(clockSlot));
      await Promise.all([
        earlyScheduler.prepareForNextSlot(clockSlot),
        vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
      ]);

      expect(chainStub.recomputeForkChoiceHead).toHaveBeenCalledExactlyOnceWith(ForkchoiceCaller.prepareNextSlot);
      expect(regenStub.getBlockSlotState).toHaveBeenLastCalledWith(
        forkChoiceStub.getHead(),
        prepareSlot,
        {dontTransferCache: true},
        RegenCaller.precomputeEpoch
      );
      expect(payloadAttributesSpy).toHaveBeenCalledTimes(2);
      expect(payloadAttributesSpy.mock.calls[1][0]).toEqual(payloadAttributesSpy.mock.calls[0][0]);
      expect(executionEngineStub.notifyForkchoiceUpdate).not.toHaveBeenCalled();
      expect(loggerStub.error).not.toHaveBeenCalled();
    });
  });
});
