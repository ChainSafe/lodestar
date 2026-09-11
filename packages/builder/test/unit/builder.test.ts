import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, defer, toRootHex} from "@lodestar/utils";
import {Builder, BuilderModules} from "../../src/builder.js";
import {BlockObserver, ObservedBlock} from "../../src/services/blockObserver.js";
import {BuilderSigner} from "../../src/services/builderSigner.js";
import {BuilderStatusTracker} from "../../src/services/builderStatusTracker.js";
import {PayloadStore} from "../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "./utils/apiStub.js";
import {ClockMock} from "./utils/clock.js";
import {getMockedLogger} from "./utils/logger.js";
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
      store: new PayloadStore(),
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
    modules.store.add({slot: 0, parentBlockRoot: Buffer.alloc(32), blockHash, payload});
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

    expect(modules.store.has(blockHash)).toBe(true);
    expect(modules.proposerPreferencesTracker.get(2, dependentRoot)).toBe(preferences);
    await clock.tickSlotFns(3, controller.signal);
    expect(modules.store.has(blockHash)).toBe(false);
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

  it("warns on a recoverable stream error and continues delivery", () => {
    new Builder(modules);
    const {onError, onEvent} = api.events.eventstream.mock.calls[0][0];
    const error = Error("connection interrupted");
    onError?.(error);
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    onEvent({type: EventType.proposerPreferences, message: {version: ForkName.gloas, data: preferences}});

    expect(logger.warn).toHaveBeenCalledWith("Failed to receive builder event", {topics: topics.join(",")}, error);
    expect(logger.error).not.toHaveBeenCalled();
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
