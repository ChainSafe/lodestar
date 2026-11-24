import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, defer, toRootHex} from "@lodestar/utils";
import {Builder, BuilderModules} from "../../src/builder.js";
import {BlockObserver, ObservedBlock} from "../../src/services/blockObserver.js";
import {BuilderSigner} from "../../src/services/builderSigner.js";
import {BuilderStatusTracker} from "../../src/services/builderStatusTracker.js";
import {HeadTracker} from "../../src/services/headTracker.js";
import {PayloadStore} from "../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "./utils/apiStub.js";
import {biddingOptions, createBiddingModules, getPayloadSourceStub} from "./utils/bidding.js";
import {ClockMock} from "./utils/clock.js";
import {getMockedLogger} from "./utils/logger.js";
import {mockGetStateBuildersResponse, mockPendingPayments} from "./utils/mocks.js";
import {mockBuiltPayload} from "./utils/payload.js";

const {EventType} = routes.events;
const topics = [EventType.headV2, EventType.block, EventType.proposerPreferences, EventType.payloadAttributes];

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
    const builderSigner = new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), keypair);
    const proposerPreferencesTracker = new ProposerPreferencesTracker();
    const headTracker = new HeadTracker();
    const payloadStore = new PayloadStore();
    const payloadSource = getPayloadSourceStub();
    modules = {
      opts: {
        logger,
        config,
        keypair,
        abortController: controller,
        api,
        executionFeeRecipient: Buffer.alloc(20),
        metrics: null,
        payloadSource,
        bidding: biddingOptions,
        reveal: {},
      },
      builderSigner,
      builderStatusTracker: new BuilderStatusTracker(api, logger, 1, null),
      blockObserver: new BlockObserver(config, logger, api),
      proposerPreferencesTracker,
      headTracker,
      clock,
      index: 1,
      payloadStore,
      ...createBiddingModules({
        api,
        config,
        logger,
        clock,
        builderSigner,
        proposerPreferencesTracker,
        headTracker,
        payloadStore,
        payloadSource,
        signal: controller.signal,
      }),
    };
  });

  afterEach(() => {
    controller.abort();
    vi.restoreAllMocks();
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
      onOpen: expect.any(Function),
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

  it("fetches known preferences on every connection without replacing live entries", async () => {
    const live = ssz.gloas.SignedProposerPreferences.defaultValue();
    live.message.proposalSlot = 1;
    const stale = ssz.gloas.SignedProposerPreferences.clone(live);
    stale.message.feeRecipient = Buffer.alloc(20, 9);
    const missed = ssz.gloas.SignedProposerPreferences.clone(live);
    missed.message.proposalSlot = 2;
    const root = toRootHex(live.message.dependentRoot);
    api.beacon.getProposerPreferences.mockResolvedValue(
      mockApiResponse({data: [stale, missed], meta: {version: ForkName.gloas}})
    );
    new Builder(modules);
    const {onOpen, onEvent, signal} = api.events.eventstream.mock.calls[0][0];
    expect(api.beacon.getProposerPreferences).not.toHaveBeenCalled();

    onEvent({type: EventType.proposerPreferences, message: {version: ForkName.gloas, data: live}});
    onOpen?.();
    await vi.waitFor(() => expect(modules.proposerPreferencesTracker.get(2, root)).toBe(missed));
    expect(modules.proposerPreferencesTracker.get(1, root)).toBe(live);
    expect(api.beacon.getProposerPreferences).toHaveBeenCalledExactlyOnceWith({}, {signal});

    // Reconnect
    onOpen?.();
    expect(api.beacon.getProposerPreferences).toHaveBeenCalledTimes(2);
  });

  it("keeps live delivery working when fetching preferences fails", async () => {
    const error = Error("not supported");
    api.beacon.getProposerPreferences.mockRejectedValue(error);
    new Builder(modules);
    const {onOpen, onEvent} = api.events.eventstream.mock.calls[0][0];
    onOpen?.();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith("Failed to fetch proposer preferences", {}, error));

    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    onEvent({type: EventType.proposerPreferences, message: {version: ForkName.gloas, data: preferences}});
    expect(modules.proposerPreferencesTracker.get(0, toRootHex(preferences.message.dependentRoot))).toBe(preferences);
    expect(controller.signal.aborted).toBe(false);
  });

  it("dispatches payload attributes to the bidder and observed blocks to the revealer", async () => {
    const onPayloadAttributes = vi.spyOn(modules.bidder, "onPayloadAttributes").mockResolvedValue();
    const onBlock = vi.spyOn(modules.revealer, "onBlock").mockResolvedValue();
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    api.beacon.getBlockV2.mockResolvedValue(
      mockApiResponse({data: block, meta: {version: ForkName.gloas, executionOptimistic: false, finalized: false}})
    );
    new Builder(modules);
    const {onEvent} = api.events.eventstream.mock.calls[0][0];

    const payloadAttributes = {version: ForkName.gloas, data: ssz.gloas.SSEPayloadAttributes.defaultValue()};
    onEvent({type: EventType.payloadAttributes, message: payloadAttributes});
    expect(onPayloadAttributes).toHaveBeenCalledExactlyOnceWith(payloadAttributes);

    const blockRoot = toRootHex(Buffer.alloc(32, 1));
    onEvent({type: EventType.block, message: {slot: 0, block: blockRoot, executionOptimistic: false}});
    await vi.waitFor(() => expect(onBlock).toHaveBeenCalledOnce());
    expect(onBlock.mock.calls[0][0]).toMatchObject({
      blockRoot,
      slot: 0,
      signedBid: block.message.body.signedExecutionPayloadBid,
    });
  });

  it("tracks announced heads", () => {
    new Builder(modules);
    const {onEvent} = api.events.eventstream.mock.calls[0][0];

    const head = {
      slot: 1,
      block: toRootHex(Buffer.alloc(32, 1)),
      state: toRootHex(Buffer.alloc(32, 2)),
      payloadStatus: "empty" as const,
      epochTransition: false,
      currentEpochDependentRoot: toRootHex(Buffer.alloc(32, 3)),
      nextEpochDependentRoot: toRootHex(Buffer.alloc(32, 4)),
      executionOptimistic: false,
    };
    onEvent({type: EventType.headV2, message: {version: ForkName.gloas, data: head}});
    expect(modules.headTracker.getDependentRoot(head.block, 1)).toBe(head.currentEpochDependentRoot);
    expect(modules.headTracker.getDependentRoot(head.block, SLOTS_PER_EPOCH)).toBe(head.nextEpochDependentRoot);
  });

  describe("payment reconciliation", () => {
    const stateRoot = (slot: number) => toRootHex(Buffer.alloc(32, 100 + slot));

    function recordWonBid(slot: number, value: number): void {
      const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
      signedBid.message.slot = slot;
      signedBid.message.parentBlockHash = Buffer.alloc(32, 2);
      signedBid.message.parentBlockRoot = Buffer.alloc(32, 3);
      signedBid.message.blockHash = Buffer.alloc(32, 4);
      signedBid.message.value = value;
      const bid = modules.ledger.recordBid({signedBid, signedBidRoot: toRootHex(Buffer.alloc(32, slot))});
      modules.ledger.recordWin(bid, toRootHex(Buffer.alloc(32, slot)));
    }

    function announceHead(onEvent: (event: routes.events.BeaconEvent) => void, slot: number): void {
      onEvent({
        type: EventType.headV2,
        message: {
          version: ForkName.gloas,
          data: {
            slot,
            block: toRootHex(Buffer.alloc(32, slot)),
            state: stateRoot(slot),
            payloadStatus: "empty",
            epochTransition: false,
            currentEpochDependentRoot: toRootHex(Buffer.alloc(32, 3)),
            nextEpochDependentRoot: toRootHex(Buffer.alloc(32, 4)),
            executionOptimistic: false,
          },
        },
      });
    }

    /** Pending payment of the builder for a bid won in `slot`, as held by a state in the same epoch */
    const paymentOf = (slot: number, value: number): [number, number, number] => [
      modules.index,
      value,
      SLOTS_PER_EPOCH + (slot % SLOTS_PER_EPOCH),
    ];

    beforeEach(() => {
      api.beacon.getStateBuilders.mockResolvedValue(mockGetStateBuildersResponse(modules.index));
      mockPendingPayments(api);
    });

    it("releases bids whose payment is pending in the state of the head", async () => {
      recordWonBid(1, 5);
      recordWonBid(2, 6);
      recordWonBid(3, 7);
      // The block of slot 1 is not part of the state, the block of slot 3 is not imported yet
      mockPendingPayments(api, {payments: [paymentOf(2, 6), paymentOf(3, 7)]});
      new Builder(modules);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      announceHead(onEvent, 2);

      await clock.tickEpochFns(1, controller.signal);

      expect(modules.ledger.getUnsettledValueGwei(1)).toBe(5 + 7);
      const stateId = stateRoot(2);
      expect(api.beacon.getBuilderPendingPayments).toHaveBeenCalledExactlyOnceWith({stateId});
      expect(api.beacon.getBuilderPendingWithdrawals).toHaveBeenCalledExactlyOnceWith({stateId});
      expect(api.beacon.getStateBuilders).toHaveBeenCalledExactlyOnceWith({stateId, builderIds: [modules.index]});

      await clock.tickSlotFns(2 + 3 * SLOTS_PER_EPOCH + 1, controller.signal);
      expect(modules.ledger.getBidsForSlot(1)).toHaveLength(1);
      expect(modules.ledger.getBidsForSlot(2)).toEqual([]);
    });

    it("does not release a bid for the pending payment of another builder or value", async () => {
      recordWonBid(1, 5);
      recordWonBid(2, 6);
      mockPendingPayments(api, {
        payments: [
          [modules.index + 1, 5, SLOTS_PER_EPOCH + 1],
          [modules.index, 7, SLOTS_PER_EPOCH + 2],
        ],
      });
      new Builder(modules);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      announceHead(onEvent, 2);

      await clock.tickEpochFns(1, controller.signal);

      expect(modules.ledger.getUnsettledValueGwei(1)).toBe(5 + 6);
    });

    it("releases a bid won in the epoch before the state", async () => {
      recordWonBid(1, 5);
      // Pending payments of the previous epoch are in the first half
      mockPendingPayments(api, {payments: [[modules.index, 5, 1]]});
      new Builder(modules);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      announceHead(onEvent, SLOTS_PER_EPOCH + 1);

      await clock.tickEpochFns(2, controller.signal);

      expect(modules.ledger.getUnsettledValueGwei(2)).toBe(0);
    });

    it("does not release a bid won at a head announced while the builder is polled", async () => {
      recordWonBid(2, 6);
      recordWonBid(3, 7);
      mockPendingPayments(api, {payments: [paymentOf(2, 6), paymentOf(3, 7)]});
      const pendingPayments = await api.beacon.getBuilderPendingPayments({stateId: "head"});
      const polling = defer<typeof pendingPayments>();
      api.beacon.getBuilderPendingPayments.mockReset().mockReturnValue(polling.promise);
      new Builder(modules);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      announceHead(onEvent, 2);

      const tick = clock.tickEpochFns(1, controller.signal);
      announceHead(onEvent, 3);
      polling.resolve(pendingPayments);
      await tick;

      expect(modules.ledger.getUnsettledValueGwei(1)).toBe(7);
      expect(api.beacon.getBuilderPendingWithdrawals).toHaveBeenCalledExactlyOnceWith({stateId: stateRoot(2)});
      expect(api.beacon.getStateBuilders).toHaveBeenCalledExactlyOnceWith({
        stateId: stateRoot(2),
        builderIds: [modules.index],
      });
    });

    it("keeps won bids reserved without a known head", async () => {
      recordWonBid(1, 5);
      mockPendingPayments(api, {payments: [paymentOf(1, 5)]});
      new Builder(modules);

      await clock.tickEpochFns(1, controller.signal);

      expect(modules.ledger.getUnsettledValueGwei(1)).toBe(5);
      expect(api.beacon.getBuilderPendingPayments).toHaveBeenCalledExactlyOnceWith({stateId: "head"});
    });

    it("polls again in the next slot if the pending payments can not be polled", async () => {
      recordWonBid(1, 5);
      mockPendingPayments(api, {payments: [paymentOf(1, 5)]});
      const pendingPayments = await api.beacon.getBuilderPendingPayments({stateId: "head"});
      api.beacon.getBuilderPendingPayments.mockReset().mockRejectedValueOnce(Error("not available"));
      api.beacon.getBuilderPendingPayments.mockResolvedValue(pendingPayments);
      new Builder(modules);
      const {onEvent} = api.events.eventstream.mock.calls[0][0];
      announceHead(onEvent, 2);

      await clock.tickEpochFns(1, controller.signal);
      expect(modules.ledger.getUnsettledValueGwei(1)).toBe(5);

      await clock.tickSlotFns(SLOTS_PER_EPOCH + 1, controller.signal);
      expect(api.beacon.getBuilderPendingPayments).toHaveBeenCalledTimes(2);
      expect(modules.ledger.getUnsettledValueGwei(1)).toBe(0);

      // Polled once per epoch again after a successful poll
      await clock.tickSlotFns(SLOTS_PER_EPOCH + 2, controller.signal);
      expect(api.beacon.getBuilderPendingPayments).toHaveBeenCalledTimes(2);
    });
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
});
