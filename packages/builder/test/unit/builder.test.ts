import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, defer, toRootHex} from "@lodestar/utils";
import {Builder, BuilderModules} from "../../src/builder.js";
import {AsyncCommitmentJournal} from "../../src/services/asyncCommitmentJournal.js";
import {BlockObserver, ObservedBlock} from "../../src/services/blockObserver.js";
import {BuilderSigner} from "../../src/services/builderSigner.js";
import {BuilderSigningGuard} from "../../src/services/builderSigningGuard.js";
import {BuilderStatusTracker} from "../../src/services/builderStatusTracker.js";
import {GossipStage} from "../../src/services/gossipStages.js";
import {PayloadStore} from "../../src/services/payloadStore.js";
import {ProposerPreferencesRecovery} from "../../src/services/proposerPreferencesRecovery.js";
import {ProposerPreferencesTracker} from "../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "./utils/apiStub.js";
import {biddingOptions, createBiddingModules, getPayloadSourceStub} from "./utils/bidding.js";
import {ClockMock} from "./utils/clock.js";
import {getMockedLogger} from "./utils/logger.js";
import {mockBuiltPayload} from "./utils/payload.js";

const {EventType} = routes.events;
const topics = [EventType.block, EventType.proposerPreferences, EventType.payloadAttributes];

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
      proposerPreferencesRecovery: new ProposerPreferencesRecovery(
        {config, logger, tracker: proposerPreferencesTracker, metrics: null, signal: controller.signal},
        {
          primary: {id: "primary", api},
          additional: [],
          genesisValidatorsRoot: toRootHex(Buffer.alloc(32)),
          genesisTime: 0,
          timeoutMs: 1000,
        }
      ),
      clock,
      index: 1,
      payloadStore,
      builderApi: null,
      ...createBiddingModules({
        api,
        config,
        logger,
        clock,
        builderSigner,
        proposerPreferencesTracker,
        payloadStore,
        payloadSource,
        signal: controller.signal,
      }),
    };
  });

  it.each([false, true])(
    "routes interleaved primary and alternate contexts through one standard handler (enabled=%s)",
    async (alternateBranches) => {
      modules.opts.bidding = {...modules.opts.bidding, alternateBranches};
      const alternate = vi.spyOn(modules.bidder, "onAlternatePayloadAttributes").mockImplementation(() => {});
      const attributes = vi.spyOn(modules.bidder, "onPayloadAttributes").mockResolvedValue();
      const builder = new Builder(modules);
      const subscription = api.events.eventstream.mock.calls[0][0];
      expect(subscription.topics).toEqual(topics);
      const primaryEvent = {version: ForkName.gloas, data: ssz.gloas.SSEPayloadAttributes.defaultValue()};
      const message: routes.events.AlternatePayloadAttributesEvent = {
        ...primaryEvent,
        version: ForkName.gloas,
        context: {role: "alternate", dependentRoot: Buffer.alloc(32), builders: []},
      };
      for (let i = 0; i < 3; i++) {
        subscription.onEvent({type: EventType.payloadAttributes, message: primaryEvent});
        subscription.onEvent({type: EventType.payloadAttributes, message});
      }
      expect(attributes.mock.calls.map(([event]) => event)).toEqual([
        primaryEvent,
        message,
        primaryEvent,
        message,
        primaryEvent,
        message,
      ]);
      expect(alternate).not.toHaveBeenCalled();
      await builder.close();
    }
  );

  afterEach(() => {
    controller.abort();
    vi.restoreAllMocks();
  });

  it("routes block events and lifecycle work to every configured identity", async () => {
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
    const extra = createBiddingModules({
      api,
      config: modules.opts.config,
      logger,
      clock,
      builderSigner: new BuilderSigner(createBeaconConfig(modules.opts.config, Buffer.alloc(32)), {
        secretKey,
        publicKey: secretKey.toPublicKey(),
      }),
      proposerPreferencesTracker: modules.proposerPreferencesTracker,
      payloadStore: modules.payloadStore,
      payloadSource: modules.opts.payloadSource,
      signal: controller.signal,
      index: 2,
    });
    const status = new BuilderStatusTracker(api, logger, 2, null);
    const stage: GossipStage = {
      deadlineBps: 9750,
      builderIndex: 2,
      ledger: extra.ledger,
      bidStore: extra.bidStore,
      bidPublisher: extra.bidPublisher,
      getBuilderStatus: () => status.getStatus(),
    };
    const journal = Object.create(AsyncCommitmentJournal.prototype) as AsyncCommitmentJournal;
    const prune = vi.spyOn(journal, "prune").mockResolvedValue();
    const close = vi.spyOn(journal, "close").mockResolvedValue();
    const poll = vi.spyOn(status, "poll").mockResolvedValue();
    modules.gossipIdentities = [{stage, builderStatusTracker: status, revealer: extra.revealer, journal}];
    const primaryReveal = vi.spyOn(modules.revealer, "onBlock").mockRejectedValue(Error("failed primary"));
    const extraReveal = vi.spyOn(extra.revealer, "onBlock").mockResolvedValue();
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    api.beacon.getBlockV2.mockResolvedValue(
      mockApiResponse({data: block, meta: {version: ForkName.gloas, executionOptimistic: false, finalized: false}})
    );
    const builder = new Builder(modules);
    api.events.eventstream.mock.calls[0][0].onEvent({
      type: EventType.block,
      message: {slot: 0, block: toRootHex(Buffer.alloc(32, 8)), executionOptimistic: false},
    });
    await vi.waitFor(() => expect(extraReveal).toHaveBeenCalledOnce());
    expect(primaryReveal).toHaveBeenCalledOnce();
    await clock.tickSlotFns(1, controller.signal);
    expect(prune).toHaveBeenCalledWith(1);
    await clock.tickEpochFns(1, controller.signal);
    expect(poll).toHaveBeenCalledWith(1);
    await builder.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects additional identities without durable storage before opening network connections", async () => {
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
    await expect(
      Builder.init({
        ...modules.opts,
        gossipIdentities: [{keypair: {secretKey, publicKey: secretKey.toPublicKey()}, deadlineBps: 9750}],
      })
    ).rejects.toThrow("GOSSIP_STAGES_REQUIRE_COMMITMENT_DIRECTORY");
    expect(api.events.eventstream).not.toHaveBeenCalled();
  });

  it("forwards alternate gossip options through initialization to the bidder", async () => {
    api.beacon.getGenesis.mockResolvedValue(
      mockApiResponse({
        data: {...ssz.phase0.Genesis.defaultValue(), genesisTime: Math.floor(Date.now() / 1000)},
      })
    );
    Object.assign(api, {config: {getSpec: vi.fn().mockResolvedValue(mockApiResponse({data: {}, meta: undefined}))}});
    api.node.getSyncingStatus.mockResolvedValue(
      mockApiResponse({
        data: {headSlot: 0, syncDistance: 0, isSyncing: false, isOptimistic: false, elOffline: false},
      })
    );
    api.beacon.getStateBuilders.mockResolvedValue(
      mockApiResponse({
        data: [
          {
            index: 1,
            status: "active",
            builder: {
              ...ssz.gloas.Builder.defaultValue(),
              pubkey: modules.opts.keypair.publicKey.toBytes(),
              balance: 10_000_000_000,
            },
          },
        ],
        meta: {executionOptimistic: false, finalized: false},
      })
    );
    await expect(Builder.init({...modules.opts, bidding: {...biddingOptions, alternateGossip: true}})).rejects.toThrow(
      "ALTERNATE_GOSSIP_REQUIRES_ALTERNATE_BRANCHES"
    );
    expect(api.beacon.getStateBuilders).toHaveBeenCalled();
    expect(api.events.eventstream).not.toHaveBeenCalled();
  });

  it("releases signer ownership when initialization fails before serving offers", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-startup-guard-"));
    try {
      await expect(
        Builder.init({
          ...modules.opts,
          commitmentDir: directory,
          payloadSource: {...modules.opts.payloadSource, supportsUpdates: true},
          bidding: {...biddingOptions, updateIntervalMs: 25},
          gossipIdentities: [{keypair: modules.opts.keypair, deadlineBps: 9750}],
        })
      ).rejects.toThrow("GOSSIP_STAGE_DUPLICATE_IDENTITY");
      expect(api.events.eventstream).not.toHaveBeenCalled();
      const next = await BuilderSigningGuard.acquire(directory);
      await next.close();
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });

  it("revokes signing at shutdown but keeps ownership until pending journal work drains", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-drain-guard-"));
    const guard = await BuilderSigningGuard.acquire(directory);
    modules.signingGuard = guard;
    modules.journal = Object.create(AsyncCommitmentJournal.prototype) as AsyncCommitmentJournal;
    const disk = defer<void>();
    vi.spyOn(modules.journal, "close").mockReturnValue(disk.promise);
    const builder = new Builder(modules);
    const closing = builder.close();
    try {
      expect(controller.signal.aborted).toBe(true);
      expect(() => guard.assertActive()).toThrow("BUILDER_SIGNER_OWNERSHIP_RELEASED");
      await expect(BuilderSigningGuard.acquire(directory)).rejects.toThrow("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE");
      disk.resolve();
      await closing;
      const next = await BuilderSigningGuard.acquire(directory);
      await next.close();
    } finally {
      disk.resolve();
      await closing;
      await guard.close();
      fs.rmSync(directory, {recursive: true, force: true});
    }
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

  it("refreshes preferences even while journal pruning is delayed or fails", async () => {
    modules.journal = Object.create(AsyncCommitmentJournal.prototype) as AsyncCommitmentJournal;
    const disk = defer<void>();
    vi.spyOn(modules.journal, "prune").mockReturnValue(disk.promise);
    vi.spyOn(modules.journal, "close").mockResolvedValue();
    const refresh = vi.spyOn(modules.proposerPreferencesRecovery, "refresh").mockResolvedValue();
    const builder = new Builder(modules);
    const tick = clock.tickSlotFns(1, controller.signal);
    expect(refresh).toHaveBeenCalledWith(1);
    disk.reject(Error("slow disk failed"));
    await tick;
    expect(logger.error).toHaveBeenCalledWith("Failed to prune builder commitments", {slot: 1}, expect.any(Error));
    await builder.close();
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

  it("fetches the proposer preferences known by the beacon node on start", async () => {
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = 2;
    api.beacon.getProposerPreferences.mockResolvedValue(
      mockApiResponse({data: [preferences], meta: {version: ForkName.gloas}})
    );

    new Builder(modules);

    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith("Recovered proposer preferences", {
        source: "primary",
        count: 1,
        added: 1,
        ignored: 0,
      })
    );
    expect(modules.proposerPreferencesTracker.get(2, toRootHex(preferences.message.dependentRoot))).toBe(preferences);
    expect(api.beacon.getProposerPreferences).toHaveBeenCalledExactlyOnceWith(undefined, {
      signal: controller.signal,
      timeoutMs: 1000,
    });
  });

  it("starts without the proposer preferences of the beacon node if they can not be fetched", async () => {
    api.beacon.getProposerPreferences.mockRejectedValue(new Error("not found"));

    new Builder(modules);

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        "Unable to fetch proposer preferences",
        {source: "primary"},
        expect.any(Error)
      )
    );
    expect(api.events.eventstream).toHaveBeenCalledOnce();
  });

  it("polls the proposer preferences again on each slot tick", async () => {
    const builder = new Builder(modules);
    await vi.waitFor(() =>
      expect(logger.verbose).toHaveBeenCalledWith("No proposer preferences to recover", {
        source: "primary",
        count: 0,
        added: 0,
        ignored: 0,
      })
    );
    // Let the startup refresh settle so the slot tick starts a new poll instead of joining it
    await new Promise((resolve) => setTimeout(resolve));

    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = 3;
    api.beacon.getProposerPreferences.mockResolvedValue(
      mockApiResponse({data: [preferences], meta: {version: ForkName.gloas}})
    );
    clock.currentSlot = 1;
    await clock.tickSlotFns(1, controller.signal);
    await vi.waitFor(() =>
      expect(modules.proposerPreferencesTracker.get(3, toRootHex(preferences.message.dependentRoot))).toBe(preferences)
    );
    expect(api.beacon.getProposerPreferences).toHaveBeenCalledTimes(2);

    await builder.close();
    await clock.tickSlotFns(2, controller.signal);
    expect(api.beacon.getProposerPreferences).toHaveBeenCalledTimes(2);
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

  it("settles and prunes won bids on slot ticks", async () => {
    const bid = {
      slot: 1,
      parentBlockHash: toRootHex(Buffer.alloc(32, 2)),
      parentBlockRoot: toRootHex(Buffer.alloc(32, 3)),
      blockHash: toRootHex(Buffer.alloc(32, 4)),
      valueGwei: 5,
      signedBidRoot: toRootHex(Buffer.alloc(32, 5)),
    };
    modules.ledger.recordBid(bid);
    modules.ledger.recordWin(bid, toRootHex(Buffer.alloc(32, 6)));
    new Builder(modules);

    await clock.tickSlotFns(bid.slot + 3 * SLOTS_PER_EPOCH, controller.signal);
    expect(modules.ledger.getUnsettledValueGwei(0)).toBe(bid.valueGwei);

    await clock.tickSlotFns(bid.slot + 3 * SLOTS_PER_EPOCH + 1, controller.signal);
    expect(modules.ledger.getUnsettledValueGwei(0)).toBe(0);
    expect(modules.ledger.getBidsForSlot(bid.slot)).toEqual([]);
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
