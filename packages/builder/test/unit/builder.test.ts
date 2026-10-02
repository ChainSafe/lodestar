import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {routes} from "@lodestar/api";
import {chainConfigToJson, createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, MIN_DEPOSIT_AMOUNT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, defer, toRootHex} from "@lodestar/utils";
import {Builder, type BuilderBidOptions, BuilderModules} from "../../src/builder.js";
import {BidLedger} from "../../src/services/bidLedger.js";
import {BidPublisher} from "../../src/services/bidPublisher.js";
import {BidSelectorErrorCode} from "../../src/services/bidSelector.js";
import {BlockObserver, ObservedBlock} from "../../src/services/blockObserver.js";
import {BuilderSigner} from "../../src/services/builderSigner.js";
import {BuilderStatusTracker} from "../../src/services/builderStatusTracker.js";
import {PayloadAttributesConsumer} from "../../src/services/payloadAttributesConsumer.js";
import type {BuiltPayload, PayloadSource} from "../../src/services/payloadSource.js";
import {PayloadStore} from "../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../src/services/proposerPreferencesTracker.js";
import {SlotBidder} from "../../src/services/slotBidder.js";
import {getApiClientStub, mockApiResponse} from "./utils/apiStub.js";
import {ClockMock} from "./utils/clock.js";
import {getMockedLogger} from "./utils/logger.js";
import {mockGetStateBuildersResponse} from "./utils/mocks.js";
import {mockBuiltPayload} from "./utils/payload.js";

const {EventType} = routes.events;
const topics = [EventType.block, EventType.proposerPreferences];

describe("Builder", () => {
  let api: ReturnType<typeof getApiClientStub>;
  let logger: ReturnType<typeof getMockedLogger>;
  let controller: AbortController;
  let clock: ClockMock;
  let modules: BuilderModules;

  beforeEach(() => {
    const config = getConfig(ForkName.gloas);
    logger = getMockedLogger();
    api = getApiClientStub();
    api.events.eventstream.mockResolvedValue(mockApiResponse({data: undefined, meta: undefined}));
    controller = new AbortController();
    clock = new ClockMock();
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    const keypair = {secretKey, publicKey: secretKey.toPublicKey()};
    modules = {
      opts: {
        logger,
        config,
        keypair,
        abortController: controller,
        api,
        executionFeeRecipient: Buffer.alloc(20),
        metrics: null,
      },
      builderSigner: new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), keypair),
      builderStatusTracker: new BuilderStatusTracker(api, logger, 1, null),
      blockObserver: new BlockObserver(config, logger, api),
      proposerPreferencesTracker: new ProposerPreferencesTracker(),
      clock,
      index: 1,
      payloadStore: new PayloadStore(),
    };
  });

  afterEach(() => {
    controller.abort();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts one shared stream after the clock and preserves slot pruning", async () => {
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = 2;
    const dependentRoot = toRootHex(preferences.message.dependentRoot);
    modules.proposerPreferencesTracker.onProposerPreferences(preferences);
    const payload = mockBuiltPayload({slot: 0});
    const blockHash = toRootHex(payload.executionPayload.blockHash);
    modules.payloadStore.add({slot: 0, parentBlockRoot: Buffer.alloc(32), blockHash, payload});
    const clockStart = vi.spyOn(clock, "start");
    const builder = new Builder(modules);

    expect(clockStart).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(api.events.eventstream).toHaveBeenCalledExactlyOnceWith({
      topics,
      signal: controller.signal,
      onEvent: expect.any(Function),
      onError: expect.any(Function),
      onClose: expect.any(Function),
    });
    expect(clockStart.mock.invocationCallOrder[0]).toBeLessThan(api.events.eventstream.mock.invocationCallOrder[0]);
    expect(logger.verbose).toHaveBeenCalledWith("Subscribing to builder events", {topics: topics.join(",")});
    expect(controller.signal.aborted).toBe(false);

    expect(modules.payloadStore.has(blockHash)).toBe(true);
    expect(modules.proposerPreferencesTracker.get(2, dependentRoot)).toBe(preferences);
    await clock.tickSlotFns(3, controller.signal);
    expect(modules.payloadStore.has(blockHash)).toBe(false);
    expect(modules.proposerPreferencesTracker.get(2, dependentRoot)).toBeNull();
    expect(api.events.eventstream).toHaveBeenCalledOnce();

    await builder.close();
    await builder.close();
    expect(controller.signal.aborted).toBe(true);
    expect(api.events.eventstream).toHaveBeenCalledOnce();
  });

  it.each([ForkName.gloas, ForkName.heze] as const)("dispatches %s block and preference events", async (version) => {
    const block = ssz[version].SignedBeaconBlock.defaultValue();
    api.beacon.getBlockV2.mockResolvedValue(
      mockApiResponse({data: block, meta: {version, executionOptimistic: false, finalized: false}})
    );
    const observed = vi.fn(async (_block: ObservedBlock) => {});
    modules.blockObserver.runOnBlock(observed);
    new Builder(modules);
    const {onEvent, signal} = api.events.eventstream.mock.calls[0][0];
    const blockRoot = toRootHex(Buffer.alloc(32, 1));

    onEvent({type: EventType.block, message: {slot: 0, block: blockRoot, executionOptimistic: false}});
    await vi.waitFor(() => expect(observed).toHaveBeenCalledOnce());
    expect(observed.mock.calls[0][0].signedBid).toBe(block.message.body.signedExecutionPayloadBid);
    expect(api.beacon.getBlockV2).toHaveBeenCalledWith({blockId: blockRoot}, {signal});

    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    const root = toRootHex(preferences.message.dependentRoot);
    onEvent({type: EventType.proposerPreferences, message: {version, data: preferences}});
    expect(modules.proposerPreferencesTracker.get(0, root)).toBe(preferences);
    expect(api.events.eventstream).toHaveBeenCalledOnce();
  });

  it("does not block preferences while a block consumer is pending", async () => {
    const pending = defer<void>();
    const processBlock = vi.spyOn(modules.blockObserver, "processBlockEvent").mockReturnValue(pending.promise);
    new Builder(modules);
    const {onEvent} = api.events.eventstream.mock.calls[0][0];
    onEvent({
      type: EventType.block,
      message: {slot: 0, block: toRootHex(Buffer.alloc(32)), executionOptimistic: false},
    });
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    onEvent({type: EventType.proposerPreferences, message: {version: ForkName.gloas, data: preferences}});

    expect(processBlock).toHaveBeenCalledOnce();
    expect(modules.proposerPreferencesTracker.get(0, toRootHex(preferences.message.dependentRoot))).toBe(preferences);
    pending.resolve(undefined);
    await pending.promise;
  });

  it("isolates a rejected block handler from preference delivery", async () => {
    const error = Error("block consumer failed");
    vi.spyOn(modules.blockObserver, "processBlockEvent").mockRejectedValueOnce(error);
    new Builder(modules);
    const {onEvent} = api.events.eventstream.mock.calls[0][0];
    onEvent({
      type: EventType.block,
      message: {slot: 0, block: toRootHex(Buffer.alloc(32)), executionOptimistic: false},
    });
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    onEvent({type: EventType.proposerPreferences, message: {version: ForkName.gloas, data: preferences}});

    expect(modules.proposerPreferencesTracker.get(0, toRootHex(preferences.message.dependentRoot))).toBe(preferences);
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith("Failed to process builder event", {eventType: EventType.block}, error)
    );
    expect(api.events.eventstream).toHaveBeenCalledOnce();
  });

  it("isolates a throwing preference handler and accepts the next event", () => {
    const error = Error("preference consumer failed");
    vi.spyOn(modules.proposerPreferencesTracker, "onProposerPreferences").mockImplementationOnce(() => {
      throw error;
    });
    new Builder(modules);
    const {onEvent} = api.events.eventstream.mock.calls[0][0];
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    const event = {type: EventType.proposerPreferences, message: {version: ForkName.gloas, data: preferences}} as const;
    onEvent(event);
    onEvent(event);

    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to process builder event",
      {eventType: EventType.proposerPreferences},
      error
    );
    expect(modules.proposerPreferencesTracker.get(0, toRootHex(preferences.message.dependentRoot))).toBe(preferences);
  });

  it("ignores unrelated topics", () => {
    const processBlock = vi.spyOn(modules.blockObserver, "processBlockEvent");
    const trackPreferences = vi.spyOn(modules.proposerPreferencesTracker, "onProposerPreferences");
    new Builder(modules);
    api.events.eventstream.mock.calls[0][0].onEvent({
      type: EventType.blockGossip,
      message: {slot: 0, block: toRootHex(Buffer.alloc(32))},
    });
    expect(processBlock).not.toHaveBeenCalled();
    expect(trackPreferences).not.toHaveBeenCalled();
  });

  it("does not subscribe when already aborted", () => {
    controller.abort();
    new Builder(modules);
    expect(api.events.eventstream).not.toHaveBeenCalled();
  });

  it("ignores both topics after shutdown", async () => {
    const processBlock = vi.spyOn(modules.blockObserver, "processBlockEvent");
    const trackPreferences = vi.spyOn(modules.proposerPreferencesTracker, "onProposerPreferences");
    const builder = new Builder(modules);
    const {onEvent, signal} = api.events.eventstream.mock.calls[0][0];
    await builder.close();
    onEvent({
      type: EventType.block,
      message: {slot: 0, block: toRootHex(Buffer.alloc(32)), executionOptimistic: false},
    });
    onEvent({
      type: EventType.proposerPreferences,
      message: {version: ForkName.gloas, data: ssz.gloas.SignedProposerPreferences.defaultValue()},
    });

    expect(signal.aborted).toBe(true);
    expect(processBlock).not.toHaveBeenCalled();
    expect(trackPreferences).not.toHaveBeenCalled();
    expect(api.beacon.getBlockV2).not.toHaveBeenCalled();
  });

  it("logs a stream error and continues delivery", () => {
    new Builder(modules);
    const {onError, onEvent} = api.events.eventstream.mock.calls[0][0];
    const error = Error("connection interrupted");
    onError?.(error);
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    onEvent({type: EventType.proposerPreferences, message: {version: ForkName.gloas, data: preferences}});

    expect(logger.error).toHaveBeenCalledWith("Failed to receive builder event", {topics: topics.join(",")}, error);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(modules.proposerPreferencesTracker.get(0, toRootHex(preferences.message.dependentRoot))).toBe(preferences);
    expect(api.events.eventstream).toHaveBeenCalledOnce();
  });

  it("distinguishes terminal closure from shutdown", async () => {
    const builder = new Builder(modules);
    const {onClose, onError} = api.events.eventstream.mock.calls[0][0];
    onClose?.();
    expect(logger.error).toHaveBeenCalledWith("Builder event stream closed unexpectedly", {topics: topics.join(",")});

    logger.error.mockClear();
    await builder.close();
    onClose?.();
    onError?.(Error("aborted"));
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.verbose).toHaveBeenCalledWith("Closed builder event stream", {topics: topics.join(",")});
    expect(api.events.eventstream).toHaveBeenCalledOnce();
  });

  it("reports subscription failure without an unhandled rejection", async () => {
    const error = Error("subscription failed");
    api.events.eventstream.mockRejectedValue(error);
    new Builder(modules);
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to subscribe to builder events",
        {topics: topics.join(",")},
        error
      )
    );
  });

  it("does not report a pending subscription failure after shutdown", async () => {
    const pending = defer<Awaited<ReturnType<typeof api.events.eventstream>>>();
    api.events.eventstream.mockReturnValue(pending.promise);
    const builder = new Builder(modules);
    await builder.close();
    pending.reject(Error("closed during setup"));
    await pending.promise.catch(() => {});
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not warn when a block handler is aborted during shutdown", async () => {
    const pending = defer<void>();
    vi.spyOn(modules.blockObserver, "processBlockEvent").mockReturnValue(pending.promise);
    const builder = new Builder(modules);
    api.events.eventstream.mock.calls[0][0].onEvent({
      type: EventType.block,
      message: {slot: 0, block: toRootHex(Buffer.alloc(32)), executionOptimistic: false},
    });
    await builder.close();
    pending.reject(new ErrorAborted("block consumer"));
    await pending.promise.catch(() => {});
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ["head", "attributes", "preference"],
    ["head", "preference", "attributes"],
    ["attributes", "head", "preference"],
    ["attributes", "preference", "head"],
    ["preference", "head", "attributes"],
    ["preference", "attributes", "head"],
  ] as const)("dispatches inputs in %s/%s/%s order", async (...order) => {
    const {events, run} = configureInputs(modules, clock);
    const builder = new Builder(modules);
    const subscription = api.events.eventstream.mock.calls[0][0];
    expect(subscription.topics).toEqual([...topics, EventType.headV2, EventType.payloadAttributes]);
    for (const key of order) subscription.onEvent(events[key]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    subscription.onEvent(events.attributes);
    await builder.close();
    subscription.onEvent(events.attributes);
    expect(run).toHaveBeenCalledOnce();
    expect(api.events.eventstream).toHaveBeenCalledOnce();
  });

  it("drives the real bid services from the Builder subscription", async () => {
    const {events, run, config, data} = configureInputs(modules, clock);
    const payload = mockBuiltPayload({
      slot: data.proposalSlot,
      parentHash: data.parentBlockHash,
      prevRandao: data.payloadAttributes.prevRandao,
      valueGwei: 10,
    });
    const ledger = new BidLedger();
    Object.assign(api.beacon, {
      publishExecutionPayloadBid: vi.fn().mockResolvedValue(mockApiResponse({data: undefined, meta: undefined})),
    });
    const publisher = new BidPublisher({
      api,
      config,
      signer: modules.builderSigner,
      ledger,
      builderIndex: modules.index,
      hasPayload: (identity) => modules.payloadStore.has(identity.blockHash),
    });
    const bidder = new SlotBidder(
      {
        buildPayload: vi.fn().mockResolvedValue({...payload, fork: ForkName.gloas}),
        store: modules.payloadStore,
        policy: {computeValue: () => 1},
        ledger,
        publisher,
        builderIndex: modules.index,
        getBuilderStatus: () => ({status: "active", balance: MIN_DEPOSIT_AMOUNT + 100}),
      },
      {minOperatingBalanceGwei: MIN_DEPOSIT_AMOUNT}
    );
    run.mockImplementation((input, signal) => bidder.run(input, signal));
    const builder = new Builder(modules);
    const {onEvent} = api.events.eventstream.mock.calls[0][0];
    onEvent(events.head);
    onEvent(events.attributes);
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    onEvent(events.preference);

    await vi.waitFor(() => expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce());
    expect(modules.payloadStore.has(toRootHex(payload.executionPayload.blockHash))).toBe(true);
    expect(ledger.getBidsForSlot(data.proposalSlot)).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
    await builder.close();
  });

  it.each(["slot", "shutdown"])("cancels input work on %s without logging a late result", async (cause) => {
    const {events, run} = configureInputs(modules, clock);
    const pending = defer<Awaited<ReturnType<SlotBidder["run"]>>>();
    run.mockReturnValue(pending.promise);
    const builder = new Builder(modules);
    const {onEvent} = api.events.eventstream.mock.calls[0][0];
    onEvent(events.preference);
    onEvent(events.head);
    onEvent(events.attributes);
    expect(run).toHaveBeenCalledOnce();
    const signal = run.mock.calls[0][1];
    if (cause === "slot") {
      clock.currentSlot++;
      await clock.tickSlotFns(clock.currentSlot, controller.signal);
    } else {
      await builder.close();
    }
    expect(signal.aborted).toBe(true);
    pending.resolve({status: "not_published", reason: "policy_declined"});
    await pending.promise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    await builder.close();
  });

  describe("opt-in bid runtime", () => {
    function prepareStartup() {
      vi.useFakeTimers();
      const {events, data} = configureInputs(modules, clock);
      vi.setSystemTime(9 * modules.opts.config.SLOT_DURATION_MS + modules.opts.config.getSlotComponentDurationMs(6667));
      api.beacon.getGenesis.mockResolvedValue(
        mockApiResponse({data: ssz.phase0.Genesis.defaultValue(), meta: undefined})
      );
      Object.assign(api, {
        config: {
          getSpec: vi
            .fn()
            .mockResolvedValue(mockApiResponse({data: chainConfigToJson(modules.opts.config), meta: undefined})),
        },
      });
      api.node.getSyncingStatus.mockResolvedValue(
        mockApiResponse({
          data: {headSlot: 9, syncDistance: 0, isSyncing: false, isOptimistic: false, elOffline: false},
          meta: undefined,
        })
      );
      api.node.getNodeVersionV2.mockResolvedValue(
        mockApiResponse({
          data: {beaconNode: {code: routes.node.ClientCode.LS, name: "Lodestar", version: "test", commit: "00000000"}},
          meta: undefined,
        })
      );
      api.beacon.getStateBuilders.mockResolvedValue(
        mockGetStateBuildersResponse(1, {
          pubkey: modules.opts.keypair.publicKey.toBytes(),
          balance: MIN_DEPOSIT_AMOUNT + 100,
        })
      );
      const publish = vi.fn().mockResolvedValue(mockApiResponse({data: undefined, meta: undefined}));
      Object.assign(api.beacon, {publishExecutionPayloadBid: publish});
      const payload = mockBuiltPayload({
        slot: 10,
        parentHash: data.parentBlockHash,
        prevRandao: data.payloadAttributes.prevRandao,
        valueGwei: 10,
      });
      const source = {
        id: "el",
        prepare: vi
          .fn<PayloadSource["prepare"]>()
          .mockResolvedValue({sourceId: "el", fork: ForkName.gloas, payloadId: "0x0102030405060708"}),
        getPayload: vi.fn<PayloadSource["getPayload"]>().mockResolvedValue({...payload, fork: ForkName.gloas}),
      };
      modules.opts.bidRuntime = {
        // Vitest erases the generic return correlation; this fixture serves Gloas only.
        source: source as unknown as PayloadSource,
        policy: {computeValue: () => 1},
        orchestration: {getPayloadTimeout: 1000},
        inputs: {deadlineBps: 9000, maxInputsPerSlot: 2},
        minOperatingBalanceGwei: MIN_DEPOSIT_AMOUNT,
      };
      return {events, source, payload, publish, options: modules.opts.bidRuntime};
    }

    it("constructs and runs the bid path through Builder.init", async () => {
      const {events, source, payload, publish} = prepareStartup();
      const stored = vi.spyOn(PayloadStore.prototype, "add");
      const builder = await Builder.init(modules.opts);
      const {onEvent, topics: subscribed} = api.events.eventstream.mock.calls[0][0];
      expect(subscribed).toEqual([...topics, EventType.headV2, EventType.payloadAttributes]);
      onEvent(events.head);
      onEvent(events.attributes);
      expect(source.prepare).not.toHaveBeenCalled();
      onEvent(events.preference);
      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS / 2);
      expect(source.prepare).toHaveBeenCalledOnce();
      expect(source.prepare.mock.calls[0][0]).toMatchObject({
        forkchoiceState: {
          headBlockHash: toRootHex(events.attributes.message.data.parentBlockHash),
          safeBlockHash: toRootHex(events.attributes.message.data.safeBlockHash),
          finalizedBlockHash: toRootHex(events.attributes.message.data.finalizedBlockHash),
        },
      });
      expect(source.getPayload).toHaveBeenCalledOnce();
      expect(publish).toHaveBeenCalledOnce();
      expect(stored).toHaveBeenCalledWith(
        expect.objectContaining({blockHash: toRootHex(payload.executionPayload.blockHash)})
      );
      expect(stored.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0]);
      expect(publish.mock.calls[0][0].signedExecutionPayloadBid.message.feeRecipient).toEqual(
        events.preference.message.data.message.feeRecipient
      );
      onEvent(events.attributes);
      await vi.advanceTimersByTimeAsync(1);
      expect(publish).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
      await builder.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    async function prepareSelection(
      shouldReveal?: NonNullable<BuilderBidOptions["reveal"]>["shouldReveal"],
      enableReveal = true
    ) {
      const {events, payload, publish, options} = prepareStartup();
      options.reveal = enableReveal ? {cutoffBps: 5000, shouldReveal} : undefined;
      const reveal = vi.fn().mockResolvedValue(mockApiResponse({data: undefined, meta: undefined}));
      Object.assign(api.beacon, {publishExecutionPayloadEnvelope: reveal});
      const builder = await Builder.init(modules.opts);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      onEvent(events.preference);
      onEvent(events.head);
      onEvent(events.attributes);
      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS / 2);
      expect(publish).toHaveBeenCalledOnce();
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = 10;
      block.message.body.signedExecutionPayloadBid = ssz.gloas.SignedExecutionPayloadBid.clone(
        publish.mock.calls[0][0].signedExecutionPayloadBid
      );
      api.beacon.getBlockV2.mockResolvedValue(
        mockApiResponse({data: block, meta: {version: ForkName.gloas, executionOptimistic: false, finalized: false}})
      );
      const emitBlock = () => {
        const blockRoot = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
        api.beacon.getBlockV2.mockResolvedValue(
          mockApiResponse({data: block, meta: {version: ForkName.gloas, executionOptimistic: false, finalized: false}})
        );
        const bid = block.message.body.signedExecutionPayloadBid.message;
        const codec = routes.events.getTypeByEvent(modules.opts.config)[EventType.block];
        const message = codec.fromJson(
          codec.toJson({
            slot: block.message.slot,
            block: blockRoot,
            executionOptimistic: false,
            builderIndex: bid.builderIndex,
            blockHash: toRootHex(bid.blockHash),
          })
        );
        onEvent({type: EventType.block, message});
        return blockRoot;
      };
      return {builder, block, payload, reveal, emitBlock};
    }

    it("observes an exact local selection and publishes the retained payload", async () => {
      const shouldReveal = vi.fn(async () => true);
      const {builder, payload, reveal, emitBlock} = await prepareSelection(shouldReveal);
      const blockRoot = emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(shouldReveal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({blockRoot, slot: 10, executionOptimistic: false}),
        expect.any(AbortSignal)
      );
      expect(reveal).toHaveBeenCalledOnce();
      expect(reveal.mock.calls[0][0]).toMatchObject({
        signedEnvelopeOrContents: {
          signedExecutionPayloadEnvelope: {message: {payload: payload.executionPayload, builderIndex: 1}},
          blobs: payload.blobsBundle.blobs,
          kzgProofs: payload.blobsBundle.proofs,
        },
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(reveal).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalled();
      await builder.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("reveals promptly without requiring an additional policy callback", async () => {
      const {builder, reveal, emitBlock} = await prepareSelection();
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(reveal).toHaveBeenCalledOnce();
      await builder.close();
    });

    it.each(["disabled", "declined"])("records a selection when revealing is %s", async (mode) => {
      const recordWin = vi.spyOn(BidLedger.prototype, "recordWin");
      const {builder, reveal, emitBlock} = await prepareSelection(
        mode === "disabled" ? undefined : async () => false,
        mode !== "disabled"
      );
      const blockRoot = emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(recordWin).toHaveBeenCalledOnce();
      expect(recordWin.mock.results[0].value).toMatchObject({wonBlockRoots: [blockRoot]});
      expect(reveal).not.toHaveBeenCalled();
      await builder.close();
    });

    it("does not consult reveal policy for a changed bid", async () => {
      const shouldReveal = vi.fn(async () => true);
      const {builder, block, reveal, emitBlock} = await prepareSelection(shouldReveal);
      block.message.body.signedExecutionPayloadBid.message.value++;
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(shouldReveal).not.toHaveBeenCalled();
      expect(reveal).not.toHaveBeenCalled();
      await builder.close();
    });

    it("continues observing after a selected bid is absent from the local ledger", async () => {
      const {builder, block, reveal, emitBlock} = await prepareSelection();
      const value = block.message.body.signedExecutionPayloadBid.message.value;
      block.message.body.signedExecutionPayloadBid.message.value++;
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(reveal).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to process observed block",
        expect.anything(),
        expect.objectContaining({type: expect.objectContaining({code: BidSelectorErrorCode.UNKNOWN_BID})})
      );
      block.message = ssz.gloas.BeaconBlock.clone(block.message);
      block.message.body.signedExecutionPayloadBid.message.value = value;
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(reveal).toHaveBeenCalledOnce();
      await builder.close();
    });

    it("records the win even when the selected payload is no longer retained", async () => {
      const recordWin = vi.spyOn(BidLedger.prototype, "recordWin");
      const {builder, reveal, emitBlock} = await prepareSelection();
      vi.spyOn(PayloadStore.prototype, "get").mockReturnValue(null);
      const blockRoot = emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(recordWin.mock.results[0].value).toMatchObject({wonBlockRoots: [blockRoot]});
      expect(reveal).not.toHaveBeenCalled();
      await builder.close();
    });

    it("keeps the recorded win after publication fails", async () => {
      const recordWin = vi.spyOn(BidLedger.prototype, "recordWin");
      const {builder, reveal, emitBlock} = await prepareSelection();
      reveal.mockRejectedValueOnce(Error("connection closed"));
      const blockRoot = emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(recordWin.mock.results[0].value).toMatchObject({wonBlockRoots: [blockRoot]});
      expect(reveal).toHaveBeenCalledOnce();
      await builder.close();
    });

    it("does not publish a reveal after shutdown during the policy decision", async () => {
      const pending = defer<boolean>();
      const shouldReveal = vi.fn(() => pending.promise);
      const {builder, reveal, emitBlock} = await prepareSelection(shouldReveal);
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(shouldReveal).toHaveBeenCalledOnce();
      await builder.close();
      pending.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(reveal).not.toHaveBeenCalled();
    });

    it("rechecks retention after an asynchronous reveal decision", async () => {
      const pending = defer<boolean>();
      const {builder, reveal, emitBlock} = await prepareSelection(() => pending.promise);
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      vi.spyOn(PayloadStore.prototype, "get").mockReturnValue(null);
      pending.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(reveal).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "Selected payload expired before reveal",
        expect.objectContaining({code: "BUILDER_REVEAL_PAYLOAD_EXPIRED"})
      );
      await builder.close();
    });

    it("does not consult reveal policy after the cutoff", async () => {
      const shouldReveal = vi.fn(async () => true);
      const {builder, reveal, emitBlock} = await prepareSelection(shouldReveal);
      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS);
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(shouldReveal).not.toHaveBeenCalled();
      expect(reveal).not.toHaveBeenCalled();
      await builder.close();
    });

    it("cancels a slow reveal decision at the cutoff and ignores its late result", async () => {
      const pending = defer<boolean>();
      const shouldReveal = vi.fn<NonNullable<NonNullable<BuilderBidOptions["reveal"]>["shouldReveal"]>>(
        () => pending.promise
      );
      const {builder, reveal, emitBlock} = await prepareSelection(shouldReveal);
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(shouldReveal).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS);
      expect(shouldReveal.mock.calls[0][1].aborted).toBe(true);
      pending.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(reveal).not.toHaveBeenCalled();
      await builder.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels at the cutoff but records a subsequent successful publication response", async () => {
      const recordPublished = vi.spyOn(BidLedger.prototype, "recordRevealPublished");
      const {builder, reveal, emitBlock} = await prepareSelection(async () => true);
      const pending = defer<ReturnType<typeof mockApiResponse>>();
      reveal.mockReturnValueOnce(pending.promise);
      emitBlock();
      await vi.advanceTimersByTimeAsync(0);
      expect(reveal).toHaveBeenCalledOnce();
      const publicationSignal = reveal.mock.calls[0][1].signal;
      expect(publicationSignal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS);
      expect(publicationSignal.aborted).toBe(true);
      pending.resolve(mockApiResponse({data: undefined, meta: undefined}));
      await vi.advanceTimersByTimeAsync(0);
      expect(recordPublished).toHaveBeenCalledOnce();
      await builder.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([0, 10_000, Number.NaN, 5000.5])("rejects invalid reveal cutoff %s before startup", async (cutoffBps) => {
      const {options} = prepareStartup();
      options.reveal = {cutoffBps, shouldReveal: async () => true};
      await expect(Builder.init(modules.opts)).rejects.toMatchObject({
        type: {code: "BUILDER_REVEAL_INVALID_CUTOFF"},
      });
      expect(api.events.eventstream).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not construct bid services without an explicit runtime configuration", async () => {
      const {source} = prepareStartup();
      delete modules.opts.bidRuntime;
      const builder = await Builder.init(modules.opts);
      expect(api.events.eventstream.mock.calls[0][0].topics).toEqual(topics);
      expect(source.prepare).not.toHaveBeenCalled();
      await builder.close();
    });

    it("prunes the runtime ledger on startup and each slot", async () => {
      prepareStartup();
      const prune = vi.spyOn(BidLedger.prototype, "prune");
      const builder = await Builder.init(modules.opts);
      expect(prune).toHaveBeenCalledExactlyOnceWith(9);
      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS);
      expect(prune).toHaveBeenLastCalledWith(10);
      expect(prune).toHaveBeenCalledTimes(2);
      await builder.close();
      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS);
      expect(prune).toHaveBeenCalledTimes(2);
    });

    it("does not start the runtime if cancellation arrives during identity lookup", async () => {
      prepareStartup();
      api.beacon.getStateBuilders.mockImplementationOnce(async () => {
        controller.abort();
        return mockGetStateBuildersResponse(1, {pubkey: modules.opts.keypair.publicKey.toBytes()});
      });
      await expect(Builder.init(modules.opts)).rejects.toMatchObject({name: "AbortError"});
      expect(api.events.eventstream).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("rejects invalid runtime options before starting the clock or subscription", async () => {
      const {options} = prepareStartup();
      options.inputs.maxInputsPerSlot = 0;
      await expect(Builder.init(modules.opts)).rejects.toMatchObject({
        type: {code: "PAYLOAD_INPUT_INVALID_OPTIONS"},
      });
      expect(api.events.eventstream).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels the stale build on a new head while allowing its replacement to finish", async () => {
      const {events, source, payload, publish} = prepareStartup();
      const pending = defer<Awaited<ReturnType<PayloadSource["prepare"]>>>();
      source.prepare.mockReturnValueOnce(pending.promise);
      const builder = await Builder.init(modules.opts);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      onEvent(events.preference);
      onEvent(events.head);
      onEvent(events.attributes);
      onEvent(events.attributes);
      expect(source.prepare).toHaveBeenCalledOnce();
      const staleSignal = source.prepare.mock.calls[0][1];

      const replacement = ssz.gloas.SSEPayloadAttributes.clone(events.attributes.message.data);
      replacement.parentBlockRoot = Buffer.alloc(32, 10);
      replacement.parentBlockHash = Buffer.alloc(32, 11);
      replacement.payloadAttributes.parentBeaconBlockRoot = replacement.parentBlockRoot;
      const replacementPayload: BuiltPayload = {
        ...payload,
        fork: ForkName.gloas,
        executionPayload: {...payload.executionPayload, parentHash: replacement.parentBlockHash},
      };
      source.getPayload.mockResolvedValue(replacementPayload);
      onEvent({
        ...events.head,
        message: {
          ...events.head.message,
          data: {...events.head.message.data, block: toRootHex(replacement.parentBlockRoot)},
        },
      });
      expect(staleSignal.aborted).toBe(true);
      onEvent({...events.attributes, message: {...events.attributes.message, data: replacement}});
      expect(source.prepare).toHaveBeenCalledTimes(2);
      expect(source.prepare.mock.calls[1][1].aborted).toBe(false);
      pending.resolve({sourceId: "el", fork: ForkName.gloas, payloadId: "0x1111111111111111"});

      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS / 2);
      expect(source.getPayload).toHaveBeenCalledOnce();
      expect(source.getPayload.mock.calls[0][0].payloadId).toBe("0x0102030405060708");
      expect(publish).toHaveBeenCalledOnce();
      expect(publish.mock.calls[0][0].signedExecutionPayloadBid.message.parentBlockHash).toEqual(
        replacement.parentBlockHash
      );
      expect(logger.warn).not.toHaveBeenCalled();
      await builder.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels retrieval on a new head and never publishes its late result", async () => {
      const {events, source, payload, publish} = prepareStartup();
      const pending = defer<Awaited<ReturnType<PayloadSource["getPayload"]>>>();
      source.getPayload.mockReturnValue(pending.promise);
      const builder = await Builder.init(modules.opts);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      onEvent(events.preference);
      onEvent(events.head);
      onEvent(events.attributes);
      const config = modules.opts.config;
      await vi.advanceTimersByTimeAsync(
        config.getSlotComponentDurationMs(9000) - config.getSlotComponentDurationMs(6667)
      );
      expect(source.getPayload).toHaveBeenCalledOnce();
      const retrievalSignal = source.getPayload.mock.calls[0][1];
      onEvent({
        ...events.head,
        message: {...events.head.message, data: {...events.head.message.data, block: toRootHex(Buffer.alloc(32, 10))}},
      });
      expect(retrievalSignal.aborted).toBe(true);
      pending.resolve({...payload, fork: ForkName.gloas});
      await vi.advanceTimersByTimeAsync(1);
      expect(publish).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      await builder.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels a pending build on shutdown and ignores its late result", async () => {
      const {events, source, publish} = prepareStartup();
      const pending = defer<Awaited<ReturnType<PayloadSource["prepare"]>>>();
      source.prepare.mockReturnValue(pending.promise);
      const builder = await Builder.init(modules.opts);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      onEvent(events.preference);
      onEvent(events.head);
      onEvent(events.attributes);
      expect(source.prepare).toHaveBeenCalledOnce();
      await builder.close();
      expect(source.prepare.mock.calls[0][1].aborted).toBe(true);
      pending.resolve({sourceId: "el", fork: ForkName.gloas, payloadId: "0x0102030405060708"});
      await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS);
      expect(source.getPayload).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["slot", "parentRoot", "parentHash", "blockHash"])(
      "does not publish if retained %s identity differs",
      async (field) => {
        const {events, publish} = prepareStartup();
        const add = PayloadStore.prototype.add;
        vi.spyOn(PayloadStore.prototype, "add").mockImplementation(function (this: PayloadStore, stored) {
          if (field === "slot") stored.slot++;
          if (field === "parentRoot") stored.parentBlockRoot = Buffer.alloc(32, 9);
          if (field === "parentHash") stored.payload.executionPayload.parentHash = Buffer.alloc(32, 9);
          if (field === "blockHash") stored.payload.executionPayload.blockHash = Buffer.alloc(32, 9);
          add.call(this, stored);
        });
        const builder = await Builder.init(modules.opts);
        const {onEvent} = api.events.eventstream.mock.calls[0][0];
        onEvent(events.preference);
        onEvent(events.head);
        onEvent(events.attributes);
        await vi.advanceTimersByTimeAsync(modules.opts.config.SLOT_DURATION_MS / 2);
        expect(publish).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          "Failed to process builder event",
          {eventType: EventType.payloadAttributes},
          expect.objectContaining({type: expect.objectContaining({code: "BID_PUBLISHER_ERROR_PAYLOAD_NOT_RETAINED"})})
        );
        await builder.close();
      }
    );
  });
});

function configureInputs(modules: BuilderModules, clock: ClockMock) {
  const config = createBeaconConfig(modules.opts.config, Buffer.alloc(32));
  clock.currentSlot = 9;
  const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
  data.proposalSlot = 10;
  data.proposerIndex = 7;
  data.parentBlockRoot = Buffer.alloc(32, 2);
  data.parentBlockHash = Buffer.alloc(32, 3);
  data.safeBlockHash = Buffer.alloc(32, 4);
  data.finalizedBlockHash = Buffer.alloc(32, 5);
  data.payloadAttributes.slotNumber = data.proposalSlot;
  data.payloadAttributes.parentBeaconBlockRoot = data.parentBlockRoot;
  data.payloadAttributes.timestamp = (data.proposalSlot * config.SLOT_DURATION_MS) / 1000;
  data.payloadAttributes.targetGasLimit = 30_000_000n;
  const preference = ssz.gloas.SignedProposerPreferences.defaultValue();
  preference.message.proposalSlot = data.proposalSlot;
  preference.message.validatorIndex = data.proposerIndex;
  preference.message.targetGasLimit = data.payloadAttributes.targetGasLimit;
  preference.message.dependentRoot = Buffer.alloc(32, 6);
  preference.message.feeRecipient = Buffer.alloc(20, 8);
  const events = {
    preference: {type: EventType.proposerPreferences, message: {version: ForkName.gloas, data: preference}},
    attributes: {type: EventType.payloadAttributes, message: {version: ForkName.gloas, data}},
    head: {
      type: EventType.headV2,
      message: {
        version: ForkName.gloas,
        data: {
          slot: 9,
          block: toRootHex(data.parentBlockRoot),
          state: toRootHex(Buffer.alloc(32)),
          payloadStatus: "full",
          epochTransition: false,
          currentEpochDependentRoot: toRootHex(preference.message.dependentRoot),
          nextEpochDependentRoot: toRootHex(Buffer.alloc(32, 7)),
          executionOptimistic: false,
        },
      },
    },
  } satisfies Record<string, routes.events.BeaconEvent>;
  const run = vi.fn<SlotBidder["run"]>().mockResolvedValue({status: "not_published", reason: "policy_declined"});
  modules.payloadAttributesConsumer = new PayloadAttributesConsumer(
    {config, clock, preferences: modules.proposerPreferencesTracker, bidder: {run}},
    {
      executionFeeRecipient: modules.opts.executionFeeRecipient,
      deadlineBps: 9000,
      maxInputsPerSlot: 2,
    }
  );
  return {config, data, events, run};
}
