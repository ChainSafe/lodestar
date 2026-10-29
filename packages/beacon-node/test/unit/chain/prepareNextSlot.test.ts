import {Mock, MockInstance, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {BeaconEngineErrorCode} from "../../../src/chain/beaconEngine/interface.js";
import {IChainOptions} from "../../../src/chain/options.js";
import {PrepareNextSlotScheduler} from "../../../src/chain/prepareNextSlot.js";
import {PayloadIdCache} from "../../../src/execution/engine/payloadIdCache.js";
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
  let updateBuilderStatus: MockedBeaconChain["updateBuilderStatus"];
  let executionEngineStub: MockedBeaconChain["executionEngine"];
  const emitPayloadAttributes = true;
  const proposerIndex = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    chainStub = getMockedBeaconChain({clock: "real", genesisTime: 0});
    updateBuilderStatus = chainStub.updateBuilderStatus;
    forkChoiceStub = chainStub.forkChoice;
    forkChoiceStub.getHead.mockReturnValue(zeroProtoBlock);
    forkChoiceStub.getJustifiedCheckpoint.mockReturnValue({
      epoch: 0,
      root: new Uint8Array(32),
      rootHex: zeroProtoBlock.blockRoot,
    });
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
      forkChoiceStub.getHead.mockReturnValue({...zeroProtoBlock, slot: 0});
      const prepare = vi.spyOn(chainStub.beaconEngine, "prepareForNextSlot");

      const preparing = scheduler.prepareForNextSlot(clockSlot);
      await vi.advanceTimersByTimeAsync(7999);
      expect(chainStub.recomputeForkChoiceHeadSync).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      chainStub.emitter.on(routes.events.EventType.payloadAttributes, vi.fn());
      await vi.advanceTimersByTimeAsync(1);
      expect(chainStub.recomputeForkChoiceHeadSync).toHaveBeenCalledOnce();
      expect(prepare).toHaveBeenCalledWith(clockSlot, {produceSSEPayloadAttributes: true});
      await preparing;
    }
  );

  it("pre bellatrix - should not run due to not last slot of epoch", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    await scheduler.prepareForNextSlot(3);
    expect(chainStub.recomputeForkChoiceHeadSync).not.toHaveBeenCalled();
  });

  it("pre bellatrix - should skip, headSlot is more than 1 epoch to prepare slot", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    forkChoiceStub.getHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 2} as ProtoBlock);
    await Promise.all([
      scheduler.prepareForNextSlot(2 * SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHeadSync).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("pre bellatrix - should run regen.getBlockSlotState", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    forkChoiceStub.getHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    (regenStub.getBlockSlotState as Mock).mockResolvedValue(undefined);
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHeadSync).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
  });

  it("pre bellatrix - should handle regen.getBlockSlotState error", async () => {
    getForkStub.mockReturnValue(ForkName.phase0);
    forkChoiceStub.getHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    regenStub.getBlockSlotState.mockRejectedValue("Unit test error");
    expect(loggerStub.error).not.toHaveBeenCalled();
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHeadSync).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
    expect(loggerStub.error).toHaveBeenCalledTimes(1);
  });

  it("bellatrix - should skip, headSlot is more than 1 epoch to prepare slot", async () => {
    getForkStub.mockReturnValue(ForkName.bellatrix);
    forkChoiceStub.getHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 2} as ProtoBlock);
    await Promise.all([
      scheduler.prepareForNextSlot(2 * SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHeadSync).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("bellatrix - should skip, no block proposer", async () => {
    getForkStub.mockReturnValue(ForkName.bellatrix);
    forkChoiceStub.getHead.mockReturnValue({slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    const state = new BeaconStateView(generateCachedBellatrixState());
    regenStub.getBlockSlotState.mockResolvedValue(state);
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHeadSync).toHaveBeenCalledOnce();
    expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
  });

  it.each([
    [true, true, true, SLOTS_PER_EPOCH - 1],
    [true, false, true, SLOTS_PER_EPOCH - 1],
    [true, true, false, SLOTS_PER_EPOCH - 1],
    [true, false, false, SLOTS_PER_EPOCH - 1],
    [false, true, true, SLOTS_PER_EPOCH - 1],
    [false, false, true, SLOTS_PER_EPOCH - 1],
    [false, true, false, SLOTS_PER_EPOCH - 1],
    [false, false, false, SLOTS_PER_EPOCH - 1],
    [false, true, true, SLOTS_PER_EPOCH],
  ] as const)(
    "fulu - proposer=%s emitPayloadAttributes=%s subscriber=%s prepareSlot=%i",
    async (hasProposer, emitPayloadAttributes, hasListener, prepareSlot) => {
      const spy = vi.fn();
      if (hasListener) chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
      const listenerCount = vi.spyOn(chainStub.emitter, "listenerCount");
      const prepare = vi.spyOn(chainStub.beaconEngine, "prepareForNextSlot");
      vi.spyOn(chainStub, "opts", "get").mockReturnValue({emitPayloadAttributes} as IChainOptions);
      getForkStub.mockReturnValue(ForkName.fulu);
      forkChoiceStub.getHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
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
      const preparedState = makeState(prepareSlot);
      const computeStateHashTreeRoot = vi.spyOn(preparedState, "hashTreeRoot");
      const getExpectedWithdrawals = vi.spyOn(preparedState, "getExpectedWithdrawals");
      regenStub.getBlockSlotState.mockResolvedValue(preparedState);
      beaconProposerCacheStub.has.mockReturnValue(hasProposer);
      beaconProposerCacheStub.getOrDefault.mockReturnValue("0x fee recipient address");
      (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

      await Promise.all([
        scheduler.prepareForNextSlot(prepareSlot - 1),
        vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
      ]);

      expect(chainStub.recomputeForkChoiceHeadSync).toHaveBeenCalledOnce();
      expect(regenStub.getBlockSlotState).toHaveBeenCalledOnce();
      expect(prepare).toHaveBeenCalledWith(prepareSlot - 1, {produceSSEPayloadAttributes: hasListener});
      expect(listenerCount).toHaveBeenCalledExactlyOnceWith(routes.events.EventType.payloadAttributes);
      expect(updateBuilderStatus).toHaveBeenCalledTimes(hasProposer ? 1 : 0);
      expect(forkChoiceStub.getFinalizedBlock).toHaveBeenCalledTimes(2);
      expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledTimes(hasProposer ? 1 : 0);
      if (hasProposer) {
        expect(executionEngineStub.notifyForkchoiceUpdate).toHaveBeenCalledWith(
          ForkName.fulu,
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.objectContaining({withdrawals: [], parentBeaconBlockRoot: expect.any(Uint8Array)})
        );
      }
      const shouldEmit = hasListener && (hasProposer || emitPayloadAttributes);
      expect(spy).toHaveBeenCalledTimes(shouldEmit ? 1 : 0);
      expect(getExpectedWithdrawals).toHaveBeenCalledTimes(hasProposer || shouldEmit ? 1 : 0);
      const result = await prepare.mock.results[0].value;
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Slot preparation failed");
      expect(result.data?.payloadAttributes).toEqual(shouldEmit ? spy.mock.calls[0][0] : undefined);
      if (shouldEmit) {
        expect(spy.mock.calls[0][0].data.proposalSlot).toBe(prepareSlot);
        expect(spy.mock.invocationCallOrder[0]).toBeGreaterThan(computeStateHashTreeRoot.mock.invocationCallOrder[0]);
        if (hasProposer) {
          expect(spy.mock.invocationCallOrder[0]).toBeGreaterThan(
            executionEngineStub.notifyForkchoiceUpdate.mock.invocationCallOrder[0]
          );
          // attributes computed for the event are reused for the EL payload preparation
          expect(executionEngineStub.notifyForkchoiceUpdate.mock.calls[0][4]).toBe(
            spy.mock.calls[0][0].data.payloadAttributes
          );
        }
      }
      expect(loggerStub.error).not.toHaveBeenCalled();
    }
  );

  it("should not emit payload attributes when engine preparation fails", async () => {
    getForkStub.mockReturnValue(ForkName.fulu);
    vi.spyOn(chainStub.beaconEngine, "prepareForNextSlot").mockResolvedValue({
      ok: false,
      headUpdate: false,
      code: BeaconEngineErrorCode.INTERNAL,
      payload: {message: "EL preparation failed"},
    });
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      vi.advanceTimersByTimeAsync((config.SLOT_DURATION_MS * 2) / 3),
    ]);

    expect(spy).not.toHaveBeenCalled();
    expect(loggerStub.error).toHaveBeenCalledOnce();
  });

  it("gloas - should emit payload attributes with the forkchoice hashes sent to the execution layer", async () => {
    const safeBlockHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const finalizedBlockHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const spy = vi.fn();
    chainStub.emitter.on(routes.events.EventType.payloadAttributes, spy);
    getForkStub.mockReturnValue(ForkName.gloas);
    forkChoiceStub.getHead.mockReturnValue({...zeroProtoBlock, slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
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
    forkChoiceStub.getHead.mockReturnValue(head);
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
      expect.objectContaining({suggestedFeeRecipient: pooledFeeRecipient})
    );
    expect(loggerStub.error).not.toHaveBeenCalled();
  });

  it("post-fulu - should read proposer from head state and dial only the proposer head on reorg", async () => {
    getForkStub.mockReturnValue(ForkName.fulu);
    const headBlock = {...zeroProtoBlock, blockRoot: "0xhead", slot: SLOTS_PER_EPOCH - 3} as ProtoBlock;
    // predicted proposer-boost-reorg: build on the parent block instead of the canonical head
    const proposerHead = {...zeroProtoBlock, blockRoot: "0xparent", slot: SLOTS_PER_EPOCH - 4} as ProtoBlock;
    forkChoiceStub.getHead.mockReturnValue(headBlock);
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
    forkChoiceStub.getHead.mockReturnValue(headBlock);
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
});
