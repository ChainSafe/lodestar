import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import type {
  AlternatePayloadAttributesEvent,
  BidderOptions,
  PayloadAttributesEvent,
} from "../../../src/services/bidder.js";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidPublisher} from "../../../src/services/bidPublisher.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {PayloadSourceNotReady} from "../../../src/services/offerEligibility.js";
import type {BuildRequest, BuiltPayload, PayloadSourceResources} from "../../../src/services/payloadSource.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {createBiddingModules, getPayloadSourceStub} from "../utils/bidding.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockBuiltPayload} from "../utils/payload.js";

const dependentRoot = Buffer.alloc(32, 7);
const key = SecretKey.fromBytes(Buffer.alloc(32, 1));
const pubkey = key.toPublicKey().toBytes();

function hasReason(context: unknown, reason: string): boolean {
  return typeof context === "object" && context !== null && "reason" in context && context.reason === reason;
}

function attributes(root: number, hash: number): AlternatePayloadAttributesEvent {
  const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
  data.proposalSlot = 1;
  data.proposerIndex = 3;
  data.parentBlockRoot = Buffer.alloc(32, root);
  data.parentBlockHash = Buffer.alloc(32, hash);
  data.payloadAttributes.parentBeaconBlockRoot = data.parentBlockRoot;
  data.payloadAttributes.slotNumber = 1;
  data.payloadAttributes.timestamp = 12;
  return {
    version: ForkName.gloas,
    data,
    context: {
      role: "alternate",
      dependentRoot,
      builders: [{index: 1, pubkey, version: 0, active: true, availableGwei: 9_000_000_000}],
    },
  };
}

describe("alternate parent bidder", () => {
  let controller: AbortController;
  let pending: Promise<void>[];

  beforeEach(() => {
    vi.useFakeTimers({now: 0});
    controller = new AbortController();
    pending = [];
  });

  afterEach(async () => {
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(pending);
    vi.useRealTimers();
  });

  function setup(
    options: Partial<BidderOptions> = {},
    stageDeadlines: number[] = [],
    generations = false,
    trackOrders = false
  ) {
    const api = getApiClientStub();
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({
        data: [{slot: 1, validatorIndex: 3, pubkey: Buffer.alloc(48, 3)}],
        meta: {executionOptimistic: false, dependentRoot: toRootHex(dependentRoot)},
      })
    );
    api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
    const config = getConfig(ForkName.gloas);
    const clock = new ClockMock();
    clock.msToSlot = (slot) => slot * 12_000 - Date.now();
    clock.getCurrentSlot = () => Math.floor(Date.now() / 12_000);
    const payloadSource = getPayloadSourceStub();
    payloadSource.supportsUpdates = true;
    payloadSource.supportsBoundedAlternates = true;
    payloadSource.supportsRetainedOffers = generations;
    payloadSource.supportsPrimaryHandoff = generations;
    let generation = 0;
    const sessions = new Map<string, {request: BuildRequest; payload: BuiltPayload; signal: AbortSignal}>();
    let nextId = 0;
    payloadSource.getResources.mockImplementation(() => ({
      capacity: 2,
      active: sessions.size,
      preparing: 0,
      releasing: 0,
      uncertain: 0,
      alternatesDisabled: false,
    }));
    payloadSource.prepare.mockImplementation(async (request, signal) => {
      if (sessions.size >= 2) throw Error("SessionLimit");
      const payloadId = String(++nextId);
      const payload: BuiltPayload = {
        ...mockBuiltPayload({
          slot: request.payloadAttributes.slotNumber,
          parentHash: fromHex(request.forkchoiceState.headBlockHash),
          prevRandao: request.payloadAttributes.prevRandao,
          blockHash: Buffer.alloc(32, nextId),
        }),
        fork: ForkName.gloas,
        ...(trackOrders
          ? {orderMetadata: {version: 1 as const, orderIds: [`0x${"12".repeat(32)}`], doNotOfferBefore: 0}}
          : {}),
      };
      if (generations) {
        payload.offerEligibility = {
          generation: `0x${generation.toString(16)}`,
          namespace: "fixture",
          lease: {
            generation: `0x${generation.toString(16)}`,
            ready: true,
            validUntil: performance.now() + 250,
            validUntilUnixMs: Date.now() + 250,
          },
          ...(request.requireRetainedOffer
            ? {
                retained: {
                  id: `offer-fixture-${nextId}`,
                  namespace: "fixture",
                  parentHash: request.forkchoiceState.headBlockHash,
                  parentBeaconBlockRoot: toRootHex(request.payloadAttributes.parentBeaconBlockRoot),
                  blockHash: toRootHex(payload.executionPayload.blockHash),
                  slot: `0x${request.payloadAttributes.slotNumber.toString(16)}`,
                  closed: false,
                },
              }
            : {}),
        };
      }
      sessions.set(payloadId, {request, payload, signal});
      return {sourceId: "el", fork: ForkName.gloas, payloadId};
    });
    payloadSource.getPayload.mockImplementation(async (handle) => {
      const session = sessions.get(handle.payloadId);
      if (!session) throw Error("UnknownSession");
      if (session.payload.offerEligibility) {
        session.payload.offerEligibility.lease.validUntil = performance.now() + 250;
        session.payload.offerEligibility.lease.validUntilUnixMs = Date.now() + 250;
        session.payload.offerEligibility.lease.ready = true;
      }
      return session.payload;
    });
    payloadSource.renewOffer.mockImplementation(async (payload) => {
      const eligibility = payload.offerEligibility;
      if (!eligibility?.retained || eligibility.retained.closed || eligibility.retained.paused) return false;
      if (eligibility.generation !== `0x${generation.toString(16)}`) {
        eligibility.retained.closed = true;
        eligibility.lease.ready = false;
        return false;
      }
      eligibility.lease.validUntil = performance.now() + 250;
      eligibility.lease.validUntilUnixMs = Date.now() + 250;
      eligibility.lease.ready = true;
      return true;
    });
    payloadSource.releaseOffer.mockImplementation(async (payload) => {
      if (payload.offerEligibility?.retained) {
        payload.offerEligibility.retained.closed = true;
        payload.offerEligibility.lease.ready = false;
      }
    });
    payloadSource.retainPrimaryPayload.mockImplementation(async (handle, payload) => {
      const session = sessions.get(handle.payloadId);
      if (!session || session.payload !== payload) throw Error("PayloadSnapshotChanged");
      if (payload.offerEligibility?.generation !== `0x${generation.toString(16)}`) throw Error("StaleOrderGeneration");
      return {
        ...payload,
        offerEligibility: {
          generation: payload.offerEligibility.generation,
          namespace: "fixture",
          lease: {...payload.offerEligibility.lease},
          retained: {
            id: `offer-handoff-${handle.payloadId}`,
            namespace: "fixture",
            parentHash: session.request.forkchoiceState.headBlockHash,
            parentBeaconBlockRoot: toRootHex(session.request.payloadAttributes.parentBeaconBlockRoot),
            blockHash: toRootHex(payload.executionPayload.blockHash),
            slot: `0x${session.request.payloadAttributes.slotNumber.toString(16)}`,
            closed: false,
          },
        },
      };
    });
    payloadSource.release.mockImplementation(async (handle) => {
      const payload = sessions.get(handle.payloadId)?.payload;
      if (payload?.offerEligibility && !payload.offerEligibility.retained) payload.offerEligibility.lease.ready = false;
      sessions.delete(handle.payloadId);
    });
    const proposerPreferencesTracker = new ProposerPreferencesTracker();
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = 1;
    preferences.message.dependentRoot = dependentRoot;
    preferences.message.targetGasLimit = 60_000_000n;
    proposerPreferencesTracker.onProposerPreferences(preferences);
    const payloadStore = new PayloadStore();
    const canRetainAlternate = vi.fn(() => true);
    const retainCommitment = vi
      .fn<(bid: gloas.SignedExecutionPayloadBid) => Promise<void>>()
      .mockResolvedValue(undefined);
    const logger = getMockedLogger();
    const getBuilderStatus = vi.fn(() => ({status: "active" as const, balance: 10_000_000_000}));
    const signer = new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), {
      secretKey: key,
      publicKey: key.toPublicKey(),
    });
    const gossipStages = stageDeadlines.map((deadlineBps, i) => {
      const ledger = new BidLedger();
      return {
        deadlineBps,
        builderIndex: i + 2,
        ledger,
        bidStore: new BidStore(),
        bidPublisher: new BidPublisher({
          api,
          config,
          signer,
          ledger,
          builderIndex: i + 2,
          hasPayload: ({blockHash}) => payloadStore.has(blockHash),
          retainCommitment,
        }),
        getBuilderStatus,
      };
    });
    const modules = createBiddingModules({
      api,
      config,
      clock,
      payloadSource,
      payloadStore,
      proposerPreferencesTracker,
      logger,
      signal: controller.signal,
      builderSigner: new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), {
        secretKey: key,
        publicKey: key.toPublicKey(),
      }),
      canRetainAlternate,
      retainCommitment,
      getBuilderStatus,
      gossipStages,
      updateOptions: {updateIntervalMs: 100, alternateBranches: true, ...options},
    });
    const start = (event: PayloadAttributesEvent) => {
      pending.push(modules.bidder.onPayloadAttributes({version: event.version, data: event.data}));
    };
    const offer = (event: AlternatePayloadAttributesEvent) =>
      modules.bidStore.get(
        event.data.proposalSlot,
        toRootHex(event.data.parentBlockHash),
        toRootHex(event.data.parentBlockRoot)
      );
    return {
      ...modules,
      api,
      clock,
      payloadSource,
      payloadStore,
      sessions,
      advanceGeneration: () => {
        generation++;
      },
      start,
      offer,
      canRetainAlternate,
      retainCommitment,
      logger,
      proposerPreferencesTracker,
      getBuilderStatus,
    };
  }

  describe("alternate gossip", () => {
    it("refuses tracked metadata without an existing native offer lease", async () => {
      const m = setup({}, [], false, true);
      const primary = attributes(4, 5);
      m.start(primary);
      await vi.advanceTimersByTimeAsync(100);
      expect(m.payloadSource.getPayload).toHaveBeenCalled();
      expect(m.retainCommitment).not.toHaveBeenCalled();
      expect(m.offer(primary)).toBeNull();
    });

    it("does not mutate a shared eligibility floor when metadata conflicts", async () => {
      const m = setup({}, [], true, true);
      m.start(attributes(4, 5));
      await vi.advanceTimersByTimeAsync(100);
      const session = m.sessions.get("1");
      if (!session?.payload.offerEligibility) throw Error("Missing primary eligibility");
      const eligibility = session.payload.offerEligibility;
      expect(m.retainCommitment).toHaveBeenCalled();
      expect(eligibility.doNotOfferBefore).toBe(0);
      session.payload.orderMetadata = {
        version: 1,
        orderIds: [`0x${"34".repeat(32)}`],
        doNotOfferBefore: Date.now() + 1000,
      };
      await vi.advanceTimersByTimeAsync(100);
      expect(eligibility.doNotOfferBefore).toBe(0);
    });

    it("keeps deferred primary stages independent of retained alternate gossip", async () => {
      const m = setup({alternateGossip: true, deferUnusedGossipStages: true, primaryHandoff: true}, [9000], true);
      const primary = attributes(4, 5);
      const alternate = attributes(4, 6);
      m.start(primary);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(10_800);
      const earlierPrimary = m.offer(primary);
      const earlierAlternate = m.offer(alternate);
      expect(earlierPrimary).not.toBeNull();
      expect(earlierAlternate).not.toBeNull();
      expect(
        m.api.beacon.publishExecutionPayloadBid.mock.calls.map(([args]) => args.signedExecutionPayloadBid)
      ).toEqual([earlierPrimary, earlierAlternate]);
      expect(
        m.logger.info.mock.calls.filter(([message]) => message === "Deferred staged execution payload bid")
      ).toHaveLength(1);
      const session = m.sessions.get("1");
      if (!session) throw Error("Missing primary session");
      session.payload = {
        ...session.payload,
        executionPayload: {...session.payload.executionPayload, blockHash: Buffer.alloc(32, 42)},
        executionPayloadValue: 2_000_000_000_000_000_000n,
      };
      await vi.advanceTimersByTimeAsync(100);
      const sent = m.api.beacon.publishExecutionPayloadBid.mock.calls.map(([args]) => args.signedExecutionPayloadBid);
      expect(sent).toHaveLength(3);
      expect(sent[2].message.builderIndex).toBe(2);
      expect(toRootHex(sent[2].message.parentBlockHash)).toBe(toRootHex(primary.data.parentBlockHash));
      expect(toRootHex(sent[2].message.parentBlockRoot)).toBe(toRootHex(primary.data.parentBlockRoot));
      expect(toRootHex(sent[2].message.blockHash)).toBe(toRootHex(Buffer.alloc(32, 42)));
      expect(sent[2].message.value).toBeGreaterThan(sent[0].message.value);
      for (const signed of [earlierPrimary, earlierAlternate]) {
        if (!signed) throw Error("Missing earlier bid");
        expect(m.payloadStore.has(toRootHex(signed.message.blockHash))).toBe(true);
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledTimes(3);
    });

    async function ready(options: Partial<BidderOptions> = {}) {
      const m = setup({alternateGossip: true, ...options}, [], true);
      const alternate = attributes(4, 6);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(1500);
      const signed = m.offer(alternate);
      if (!signed) throw Error("Missing durable alternate");
      const eligibility = m.bidStore.getOfferEligibility(signed);
      if (!eligibility?.retained) throw Error("Missing retained permission");
      const alternateCalls = () =>
        m.api.beacon.publishExecutionPayloadBid.mock.calls.filter(
          ([args]) =>
            toRootHex(args.signedExecutionPayloadBid.message.parentBlockHash) ===
            toRootHex(alternate.data.parentBlockHash)
        );
      return {...m, alternate, signed, eligibility, retained: eligibility.retained, alternateCalls};
    }

    it.each([
      {enabled: false, trackOrders: false},
      {enabled: true, trackOrders: false},
      {enabled: true, trackOrders: true},
    ])(
      "gossips durable branch tuples enabled=$enabled, metadata=$trackOrders, without new retention",
      async ({enabled, trackOrders}) => {
        const m = setup({alternateGossip: enabled}, [9500], true, trackOrders);
        const contexts = [attributes(4, 5), attributes(4, 6), attributes(3, 6), attributes(3, 7)];
        const sentAt: number[] = [];
        m.api.beacon.publishExecutionPayloadBid.mockImplementation(async (_args, init) => {
          init?.beforeRequest?.();
          sentAt.push(Date.now());
          return mockApiResponse({});
        });
        m.start(contexts[0]);
        for (const event of contexts.slice(1)) m.bidder.onAlternatePayloadAttributes(event);
        await vi.advanceTimersByTimeAsync(1500);
        const retained = contexts.map((event) => m.offer(event));
        expect(retained.every(Boolean)).toBe(true);
        const journalWrites = m.retainCommitment.mock.calls.length;
        await vi.advanceTimersByTimeAsync(8699);
        expect(m.api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        const sent = m.api.beacon.publishExecutionPayloadBid.mock.calls.map(([args]) => args.signedExecutionPayloadBid);
        expect(sent).toHaveLength(enabled ? 4 : 1);
        expect(sent[0]).toBe(retained[0]);
        expect(sentAt.every((time) => time === 10_200)).toBe(true);
        expect(sent.map((bid) => bid.message.builderIndex)).toEqual(enabled ? [1, 1, 1, 1] : [1]);
        expect(m.retainCommitment).toHaveBeenCalledTimes(journalWrites);
        expect(m.payloadSource.prepare).toHaveBeenCalledTimes(4);
        if (enabled) expect(new Set(sent)).toEqual(new Set(retained));
        for (const signed of retained) {
          if (!signed) throw Error("Missing retained fixture");
          expect(m.payloadStore.has(toRootHex(signed.message.blockHash))).toBe(true);
        }
        await vi.advanceTimersByTimeAsync(100);
        expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledTimes(enabled ? 4 : 1);
      }
    );

    it.each([
      "closed",
      "generation",
      "balance",
      "preferences",
      "proposer",
      "shutdown",
      "cutoff",
      "capability",
    ] as const)("retains reveal ownership but does not gossip after %s changes", async (reason) => {
      const m = await ready();
      await vi.advanceTimersByTimeAsync(8699);
      if (reason === "closed") m.retained.closed = true;
      if (reason === "generation") {
        m.advanceGeneration();
        m.eligibility.lease.generation = "0x1";
      }
      if (reason === "balance") m.getBuilderStatus.mockReturnValue({status: "active", balance: 1_100_000_000});
      if (reason === "preferences") m.proposerPreferencesTracker.prune(2);
      if (reason === "proposer") {
        const changed = attributes(4, 6);
        changed.data.proposerIndex = 99;
        m.start(changed);
      }
      if (reason === "shutdown") controller.abort();
      if (reason === "cutoff") vi.setSystemTime(13_200);
      if (reason === "capability") m.payloadSource.supportsRetainedOffers = false;
      await vi.advanceTimersByTimeAsync(1);
      expect(m.alternateCalls()).toHaveLength(0);
      expect(m.bidStore.has(m.signed)).toBe(true);
      expect(m.payloadStore.has(toRootHex(m.signed.message.blockHash))).toBe(true);
    });

    it.each(["success", "rejected", "cutoff"] as const)(
      "protects a slow primary until its publication settles (%s)",
      async (outcome) => {
        const m = await ready();
        const response = defer<void>();
        const primary = m.offer(attributes(4, 5));
        m.api.beacon.publishExecutionPayloadBid.mockImplementation(async (args, init) => {
          init?.beforeRequest?.();
          if (args.signedExecutionPayloadBid === primary) await response.promise;
          return mockApiResponse({});
        });
        try {
          await vi.advanceTimersByTimeAsync(8700);
          expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
          expect(m.alternateCalls()).toHaveLength(0);
          const renewals = m.payloadSource.renewOffer.mock.calls.length;
          await vi.advanceTimersByTimeAsync(outcome === "cutoff" ? 3000 : 250);
          expect(m.payloadSource.renewOffer.mock.calls.length).toBeGreaterThan(renewals);
          expect(m.alternateCalls()).toHaveLength(0);
          if (outcome === "rejected") response.reject(Error("primary transport failed"));
          else response.resolve();
          await vi.advanceTimersByTimeAsync(0);
          expect(m.alternateCalls()).toHaveLength(outcome === "cutoff" ? 0 : 1);
          expect(m.api.beacon.publishExecutionPayloadBid.mock.calls[0][0].signedExecutionPayloadBid).toBe(primary);
        } finally {
          response.resolve();
        }
      }
    );

    it("releases alternate gossip when the primary has no eligible bid at its deadline", async () => {
      const m = await ready();
      await vi.advanceTimersByTimeAsync(8699);
      const primary = m.offer(attributes(4, 5));
      if (!primary) throw Error("Missing primary bid");
      const eligibility = m.bidStore.getOfferEligibility(primary);
      if (!eligibility) throw Error("Missing primary permission");
      eligibility.lease.ready = false;
      m.payloadSource.getPayload.mockRejectedValue(new PayloadSourceNotReady());
      await vi.advanceTimersByTimeAsync(1);
      expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
      expect(m.alternateCalls()).toHaveLength(1);
    });

    it("waits for the current primary instead of releasing on a replaced primary acknowledgement", async () => {
      const m = await ready();
      const firstResponse = defer<void>();
      const replacementResponse = defer<void>();
      const first = m.offer(attributes(4, 5));
      m.api.beacon.publishExecutionPayloadBid.mockImplementation(async (args, init) => {
        init?.beforeRequest?.();
        if (args.signedExecutionPayloadBid === first) await firstResponse.promise;
        else if (toRootHex(args.signedExecutionPayloadBid.message.parentBlockHash) === toRootHex(Buffer.alloc(32, 8)))
          await replacementResponse.promise;
        return mockApiResponse({});
      });
      try {
        await vi.advanceTimersByTimeAsync(8700);
        m.start(attributes(7, 8));
        await vi.advanceTimersByTimeAsync(1);
        firstResponse.resolve();
        await vi.advanceTimersByTimeAsync(250);
        expect(m.alternateCalls()).toHaveLength(0);
        expect(
          m.api.beacon.publishExecutionPayloadBid.mock.calls.some(
            ([args]) =>
              toRootHex(args.signedExecutionPayloadBid.message.parentBlockHash) === toRootHex(Buffer.alloc(32, 8))
          )
        ).toBe(true);
        replacementResponse.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(m.alternateCalls()).toHaveLength(1);
      } finally {
        firstResponse.resolve();
        replacementResponse.resolve();
      }
    });

    it("does not block a late primary behind alternate transport and gates further alternates", async () => {
      const m = await ready();
      const primary = m.offer(attributes(4, 5));
      if (!primary) throw Error("Missing primary bid");
      const eligibility = m.bidStore.getOfferEligibility(primary);
      if (!eligibility) throw Error("Missing primary permission");
      const getPayload = m.payloadSource.getPayload.getMockImplementation();
      if (!getPayload) throw Error("Missing payload fixture");
      const alternateResponse = defer<void>();
      const primaryResponse = defer<void>();
      m.api.beacon.publishExecutionPayloadBid.mockImplementation(async (args, init) => {
        init?.beforeRequest?.();
        if (args.signedExecutionPayloadBid === m.signed) await alternateResponse.promise;
        if (args.signedExecutionPayloadBid === primary) await primaryResponse.promise;
        return mockApiResponse({});
      });
      try {
        await vi.advanceTimersByTimeAsync(8699);
        eligibility.lease.ready = false;
        m.payloadSource.getPayload.mockRejectedValue(new PayloadSourceNotReady());
        await vi.advanceTimersByTimeAsync(1);
        expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
        expect(m.alternateCalls()).toHaveLength(1);
        m.payloadSource.getPayload.mockImplementation(getPayload);
        await vi.advanceTimersByTimeAsync(100);
        expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledTimes(2);
        expect(m.api.beacon.publishExecutionPayloadBid.mock.calls[1][0].signedExecutionPayloadBid).toBe(primary);
        const later = attributes(3, 6);
        m.bidder.onAlternatePayloadAttributes(later);
        await vi.advanceTimersByTimeAsync(1000);
        const signed = m.offer(later);
        expect(signed).not.toBeNull();
        expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledTimes(2);
        primaryResponse.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledTimes(3);
        expect(m.api.beacon.publishExecutionPayloadBid.mock.calls[2][0].signedExecutionPayloadBid).toBe(signed);
      } finally {
        alternateResponse.resolve();
        primaryResponse.resolve();
      }
    });

    it.each(["prepare", "getPayload"] as const)(
      "does not release alternates while a late replacement is still awaiting its first %s",
      async (phase) => {
        const m = await ready();
        const first = m.offer(attributes(4, 5));
        const firstResponse = defer<void>();
        const replacementResponse = defer<void>();
        const result = defer<void>();
        const prepare = m.payloadSource.prepare.getMockImplementation();
        const getPayload = m.payloadSource.getPayload.getMockImplementation();
        if (!prepare || !getPayload) throw Error("Missing payload fixture");
        const replacementParent = toRootHex(Buffer.alloc(32, 8));
        m.payloadSource.prepare.mockImplementation(async (...args) => {
          if (phase === "prepare" && args[0].forkchoiceState.headBlockHash === replacementParent) await result.promise;
          return prepare(...args);
        });
        m.payloadSource.getPayload.mockImplementation(async (...args) => {
          const session = m.sessions.get(args[0].payloadId);
          if (phase === "getPayload" && session?.request.forkchoiceState.headBlockHash === replacementParent)
            await result.promise;
          return getPayload(...args);
        });
        m.api.beacon.publishExecutionPayloadBid.mockImplementation(async (args, init) => {
          init?.beforeRequest?.();
          if (args.signedExecutionPayloadBid === first) await firstResponse.promise;
          else if (toRootHex(args.signedExecutionPayloadBid.message.parentBlockHash) === replacementParent)
            await replacementResponse.promise;
          return mockApiResponse({});
        });
        try {
          await vi.advanceTimersByTimeAsync(8700);
          m.start(attributes(7, 8));
          await vi.advanceTimersByTimeAsync(1);
          firstResponse.resolve();
          const renewals = m.payloadSource.renewOffer.mock.calls.length;
          await vi.advanceTimersByTimeAsync(250);
          expect(m.payloadSource.renewOffer.mock.calls.length).toBeGreaterThan(renewals);
          expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
          expect(m.alternateCalls()).toHaveLength(0);
          result.resolve();
          await vi.advanceTimersByTimeAsync(1);
          expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledTimes(2);
          expect(
            toRootHex(
              m.api.beacon.publishExecutionPayloadBid.mock.calls[1][0].signedExecutionPayloadBid.message.parentBlockHash
            )
          ).toBe(replacementParent);
          expect(m.alternateCalls()).toHaveLength(0);
          replacementResponse.resolve();
          await vi.advanceTimersByTimeAsync(0);
          expect(m.alternateCalls()).toHaveLength(1);
        } finally {
          result.resolve();
          firstResponse.resolve();
          replacementResponse.resolve();
        }
      }
    );

    it("does not gossip in dry-run mode", async () => {
      const m = setup({alternateGossip: true, dryRun: true}, [], true);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
      await vi.advanceTimersByTimeAsync(10_300);
      expect(m.api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
      expect(m.retainCommitment).not.toHaveBeenCalled();
    });

    it("selects the replacement owner before the deadline and preserves the old reveal", async () => {
      const m = await ready();
      m.advanceGeneration();
      await vi.advanceTimersByTimeAsync(1000);
      const replacement = m.offer(m.alternate);
      expect(replacement).not.toBeNull();
      expect(replacement).not.toBe(m.signed);
      const writes = m.retainCommitment.mock.calls.length;
      await vi.advanceTimersByTimeAsync(7700);
      expect(m.alternateCalls()).toHaveLength(1);
      expect(m.alternateCalls()[0][0].signedExecutionPayloadBid).toBe(replacement);
      expect(m.retainCommitment).toHaveBeenCalledTimes(writes);
      expect(m.bidStore.has(m.signed)).toBe(true);
      expect(m.payloadStore.has(toRootHex(m.signed.message.blockHash))).toBe(true);
    });

    it.each(["resolved", "lost"] as const)(
      "keeps renewal independent of %s transport and never retries",
      async (outcome) => {
        const m = await ready();
        const response = defer<void>();
        let requestSignal: AbortSignal | undefined;
        m.api.beacon.publishExecutionPayloadBid.mockImplementation(async (args, init) => {
          init?.beforeRequest?.();
          if (args.signedExecutionPayloadBid === m.signed) {
            requestSignal = init?.signal ?? undefined;
            await response.promise;
          }
          return mockApiResponse({});
        });
        await vi.advanceTimersByTimeAsync(8700);
        expect(m.alternateCalls()).toHaveLength(1);
        const renewals = m.payloadSource.renewOffer.mock.calls.length;
        await vi.advanceTimersByTimeAsync(500);
        expect(m.payloadSource.renewOffer.mock.calls.length).toBeGreaterThan(renewals);
        expect(m.bidStore.canOffer(m.signed)).toBe(true);
        expect(m.alternateCalls()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(2500);
        expect(requestSignal?.aborted).toBe(true);
        if (outcome === "lost") response.reject(Error("transport acknowledgement lost"));
        else response.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(m.alternateCalls()).toHaveLength(1);
        expect(
          m.ledger.hasSubmitted(
            1,
            toRootHex(m.alternate.data.parentBlockHash),
            toRootHex(m.alternate.data.parentBlockRoot)
          )
        ).toBe(true);
        expect(m.payloadStore.has(toRootHex(m.signed.message.blockHash))).toBe(true);
      }
    );

    it.each(["context", "lease", "cutoff"] as const)(
      "fences %s changes between ledger reservation and transport",
      async (reason) => {
        const m = await ready();
        let transported = false;
        m.api.beacon.publishExecutionPayloadBid.mockImplementation(async (args, init) => {
          if (args.signedExecutionPayloadBid === m.signed) {
            if (reason === "context") m.proposerPreferencesTracker.prune(2);
            if (reason === "lease") m.eligibility.lease.ready = false;
            if (reason === "cutoff") vi.setSystemTime(13_200);
            init?.beforeRequest?.();
            transported = true;
          }
          return mockApiResponse({});
        });
        await vi.advanceTimersByTimeAsync(8700);
        expect(m.alternateCalls()).toHaveLength(1);
        expect(transported).toBe(false);
        expect(
          m.ledger.hasSubmitted(
            1,
            toRootHex(m.alternate.data.parentBlockHash),
            toRootHex(m.alternate.data.parentBlockRoot)
          )
        ).toBe(true);
        expect(m.payloadStore.has(toRootHex(m.signed.message.blockHash))).toBe(true);
      }
    );

    it("skips a conservatively recovered journal tuple", async () => {
      const m = await ready();
      const record = m.ledger.getBidsForSlot(1).find((bid) => bid.blockHash === toRootHex(m.signed.message.blockHash));
      if (!record) throw Error("Missing journal record");
      m.ledger.recordBid(record);
      await vi.advanceTimersByTimeAsync(8700);
      expect(m.alternateCalls()).toHaveLength(0);
      expect(m.payloadStore.has(record.blockHash)).toBe(true);
    });

    it("keeps renewal alive when detached transport diagnostics throw", async () => {
      const m = await ready();
      m.api.beacon.publishExecutionPayloadBid.mockImplementation(async (args) => {
        if (args.signedExecutionPayloadBid === m.signed) throw Error("transport failed");
        return mockApiResponse({});
      });
      m.logger.error.mockImplementation(() => {
        throw Error("diagnostic failed");
      });
      await vi.advanceTimersByTimeAsync(8700);
      const renewals = m.payloadSource.renewOffer.mock.calls.length;
      await vi.advanceTimersByTimeAsync(500);
      expect(m.alternateCalls()).toHaveLength(1);
      expect(m.payloadSource.renewOffer.mock.calls.length).toBeGreaterThan(renewals);
      expect(m.bidStore.canOffer(m.signed)).toBe(true);
    });

    it.each([true, false])(
      "reuses a transferred primary only when its tuple has not gossiped: prior=%s",
      async (prior) => {
        const m = setup({alternateGossip: true, primaryHandoff: true}, [], true);
        const old = attributes(1, 40);
        m.start(old);
        await vi.advanceTimersByTimeAsync(prior ? 10_200 : 1);
        const signed = m.offer(old);
        if (!signed) throw Error("Missing primary bid");
        m.start(attributes(3, 40));
        m.bidder.onAlternatePayloadAttributes(old);
        await vi.advanceTimersByTimeAsync(prior ? 200 : 10_399);
        const calls = m.api.beacon.publishExecutionPayloadBid.mock.calls.filter(
          ([args]) =>
            toRootHex(args.signedExecutionPayloadBid.message.parentBlockRoot) === toRootHex(old.data.parentBlockRoot)
        );
        expect(calls).toHaveLength(1);
        expect(calls[0][0].signedExecutionPayloadBid).toBe(signed);
        expect(m.retainCommitment.mock.calls.filter(([bid]) => bid === signed)).toHaveLength(1);
        expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledOnce();
      }
    );
  });

  describe("primary handoff", () => {
    async function started(options: Partial<BidderOptions> = {primaryHandoff: true}) {
      const m = setup(options, [], true);
      const old = attributes(1, 40);
      m.start(old);
      await vi.advanceTimersByTimeAsync(1);
      const signed = m.offer(old);
      expect(signed).not.toBeNull();
      if (!signed) throw Error("Missing durable fixture bid");
      return {...m, old, signed};
    }

    it.each(["before", "after"])("reuses exact durable identity with metadata %s grant", async (timing) => {
      const m = await started();
      const prepare = vi.spyOn(m.bidPublisher, "prepare");
      const body = m.payloadStore.get(toRootHex(m.signed.message.blockHash))?.payload.executionPayload;
      expect(body).toBeDefined();
      m.start(attributes(3, 40));
      if (timing === "before") m.bidder.onAlternatePayloadAttributes(m.old);
      await vi.advanceTimersByTimeAsync(1);
      if (timing === "after") m.bidder.onAlternatePayloadAttributes(m.old);
      await vi.advanceTimersByTimeAsync(101);
      expect(m.offer(m.old)).toBe(m.signed);
      expect(m.payloadStore.get(toRootHex(m.signed.message.blockHash))?.payload.executionPayload.blockHash).toEqual(
        m.signed.message.blockHash
      );
      expect(m.payloadSource.prepare).toHaveBeenCalledTimes(2);
      expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledTimes(1);
      expect(m.sessions.size).toBe(1);
      expect(
        prepare.mock.calls.filter(([bid]) => toRootHex(bid.parentBlockRoot) === toRootHex(m.old.data.parentBlockRoot))
      ).toHaveLength(0);
      expect(
        m.retainCommitment.mock.calls.filter(
          ([bid]) => toRootHex(bid.message.parentBlockRoot) === toRootHex(m.old.data.parentBlockRoot)
        )
      ).toHaveLength(1);
      const retained = m.bidStore.getOfferEligibility(m.signed);
      expect(retained?.retained?.id).toBe("offer-handoff-1");
      expect(
        m.logger.debug.mock.calls.filter(
          ([message, context]) =>
            message === "Primary bid handoff" &&
            typeof context === "object" &&
            context !== null &&
            "state" in context &&
            context.state === "offered"
        )
      ).toHaveLength(1);
      expect(m.payloadSource.renewOffer.mock.calls.some(([payload]) => payload.executionPayload === body)).toBe(true);
    });

    it("starts the new primary before the grant resolves and releases the old worker after 25 ms", async () => {
      const m = await started();
      const completed = defer<void>();
      const grant = m.payloadSource.retainPrimaryPayload.getMockImplementation();
      if (!grant) throw Error("Missing fixture grant");
      m.payloadSource.retainPrimaryPayload.mockImplementation(async (...args) => {
        const payload = await grant(...args);
        await completed.promise;
        return payload;
      });
      m.start(attributes(3, 40));
      m.bidder.onAlternatePayloadAttributes(m.old);
      await vi.advanceTimersByTimeAsync(1);
      expect(m.payloadSource.prepare).toHaveBeenCalledTimes(2);
      expect(m.sessions.size).toBe(2);
      expect(m.offer(attributes(3, 40))).not.toBeNull();
      expect(m.offer(m.old)).toBeNull();
      await vi.advanceTimersByTimeAsync(25);
      expect(m.sessions.size).toBe(1);
      expect(m.offer(m.old)).toBeNull();
      completed.resolve();
      await vi.advanceTimersByTimeAsync(1);
      expect(m.offer(m.old)).toBeNull();
      expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
    });

    it.each(["disabled", "unsupported"])("does not request grants when %s", async (mode) => {
      const m = await started({primaryHandoff: mode !== "disabled"});
      if (mode === "unsupported") m.payloadSource.supportsPrimaryHandoff = false;
      m.start(attributes(3, 40));
      await vi.advanceTimersByTimeAsync(1);
      expect(m.payloadSource.retainPrimaryPayload).not.toHaveBeenCalled();
      expect(m.offer(m.old)).toBeNull();
    });

    it.each(["dependent root", "attributes", "collateral", "preferences", "inactive"])(
      "refuses fresh alternate %s changes without signing again",
      async (change) => {
        const m = await started();
        m.start(attributes(3, 40));
        await vi.advanceTimersByTimeAsync(1);
        const event = structuredClone(m.old);
        if (change === "dependent root") event.context.dependentRoot = Buffer.alloc(32, 9);
        if (change === "attributes") event.data.payloadAttributes.prevRandao = Buffer.alloc(32, 9);
        if (change === "collateral") event.context.builders[0].availableGwei = 0;
        if (change === "preferences") {
          const preference = ssz.gloas.SignedProposerPreferences.defaultValue();
          preference.message.proposalSlot = 1;
          preference.message.dependentRoot = dependentRoot;
          preference.message.targetGasLimit = 60_000_000n;
          preference.message.feeRecipient = Buffer.alloc(20, 9);
          vi.spyOn(m.proposerPreferencesTracker, "get").mockReturnValue(preference);
        }
        if (change === "inactive") m.getBuilderStatus.mockReturnValue({status: "active", balance: 0});
        m.bidder.onAlternatePayloadAttributes(event);
        await vi.advanceTimersByTimeAsync(101);
        expect(m.offer(m.old)).toBeNull();
        expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
        expect(
          m.retainCommitment.mock.calls.filter(
            ([bid]) => toRootHex(bid.message.parentBlockRoot) === toRootHex(m.old.data.parentBlockRoot)
          )
        ).toHaveLength(1);
      }
    );

    it("fences a generation transition after grant while preserving the old signed reveal", async () => {
      const m = await started();
      m.start(attributes(3, 40));
      await vi.advanceTimersByTimeAsync(1);
      m.advanceGeneration();
      m.bidder.onAlternatePayloadAttributes(m.old);
      await vi.advanceTimersByTimeAsync(1);
      expect(m.offer(m.old)).toBeNull();
      expect(m.bidStore.has(m.signed)).toBe(true);
      expect(m.payloadStore.has(toRootHex(m.signed.message.blockHash))).toBe(true);
      expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])(
      "waits for fresh primary duties and rejects changed dependent root (%s)",
      async (changed) => {
        const m = await started();
        const duties = defer<Awaited<ReturnType<typeof m.api.validator.getProposerDutiesV2>>>();
        m.api.validator.getProposerDutiesV2.mockReturnValueOnce(duties.promise);
        m.start(attributes(3, 40));
        m.bidder.onAlternatePayloadAttributes(m.old);
        await vi.advanceTimersByTimeAsync(1);
        expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledTimes(1);
        expect(m.offer(m.old)).toBeNull();
        expect(m.payloadSource.renewOffer).not.toHaveBeenCalled();
        duties.resolve(
          mockApiResponse({
            data: [{slot: 1, validatorIndex: 3, pubkey: Buffer.alloc(48, 3)}],
            meta: {executionOptimistic: false, dependentRoot: toRootHex(changed ? Buffer.alloc(32, 9) : dependentRoot)},
          })
        );
        await vi.advanceTimersByTimeAsync(101);
        if (changed) {
          expect(m.offer(m.old)).toBeNull();
          expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
        } else expect(m.offer(m.old)).toBe(m.signed);
      }
    );

    it.each(["PayloadSnapshotChanged", "StaleOrderGeneration"])(
      "does not retry a native %s rejection",
      async (reason) => {
        const m = await started();
        m.payloadSource.retainPrimaryPayload.mockRejectedValueOnce(Error(reason));
        m.start(attributes(3, 40));
        m.bidder.onAlternatePayloadAttributes(m.old);
        await vi.advanceTimersByTimeAsync(501);
        expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledTimes(1);
        expect(m.bidStore.canOffer(m.signed)).toBe(false);
        expect(m.bidStore.has(m.signed)).toBe(true);
        expect(m.payloadSource.prepare.mock.calls.filter(([r]) => !r.requireRetainedOffer)).toHaveLength(2);
      }
    );

    it("preserves ordinary reconstruction when metadata wait expires before fresh duties", async () => {
      const m = await started();
      const duties = defer<Awaited<ReturnType<typeof m.api.validator.getProposerDutiesV2>>>();
      m.api.validator.getProposerDutiesV2.mockReturnValueOnce(duties.promise);
      m.start(attributes(3, 40));
      m.bidder.onAlternatePayloadAttributes(m.old);
      await vi.advanceTimersByTimeAsync(501);
      expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
      expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledTimes(1);
      expect(m.payloadSource.prepare).toHaveBeenCalledTimes(1);
      duties.resolve(
        mockApiResponse({
          data: [{slot: 1, validatorIndex: 3, pubkey: Buffer.alloc(48, 3)}],
          meta: {executionOptimistic: false, dependentRoot: toRootHex(dependentRoot)},
        })
      );
      await vi.advanceTimersByTimeAsync(501);
      expect(m.payloadSource.prepare.mock.calls.filter(([r]) => r.requireRetainedOffer)).toHaveLength(1);
      expect(m.offer(m.old)).not.toBeNull();
      expect(m.offer(m.old)).not.toBe(m.signed);
      expect(
        m.logger.debug.mock.calls.some(
          ([message, context]) =>
            message === "Primary bid handoff" &&
            typeof context === "object" &&
            context !== null &&
            "state" in context &&
            context.state === "fallback"
        )
      ).toBe(true);
    });

    it.each(["duties", "grant"])("preserves A's fallback across A to B to C while %s is pending", async (waiting) => {
      const m = await started();
      const duties = defer<Awaited<ReturnType<typeof m.api.validator.getProposerDutiesV2>>>();
      const completed = defer<void>();
      const grant = m.payloadSource.retainPrimaryPayload.getMockImplementation();
      if (!grant) throw Error("Missing fixture grant");
      if (waiting === "duties") m.api.validator.getProposerDutiesV2.mockReturnValueOnce(duties.promise);
      else
        m.payloadSource.retainPrimaryPayload.mockImplementationOnce(async (...args) => {
          const payload = await grant(...args);
          await completed.promise;
          return payload;
        });
      try {
        m.start(attributes(3, 40));
        m.bidder.onAlternatePayloadAttributes(m.old);
        await vi.advanceTimersByTimeAsync(1);
        expect(m.offer(m.old)).toBeNull();
        m.start(attributes(4, 40));
        completed.resolve();
        await vi.advanceTimersByTimeAsync(1);
        duties.resolve(
          mockApiResponse({
            data: [{slot: 1, validatorIndex: 3, pubkey: Buffer.alloc(48, 3)}],
            meta: {executionOptimistic: false, dependentRoot: toRootHex(dependentRoot)},
          })
        );
        await vi.advanceTimersByTimeAsync(701);
        expect(m.offer(attributes(4, 40))).not.toBeNull();
        expect(
          m.payloadSource.prepare.mock.calls.filter(
            ([r]) =>
              r.requireRetainedOffer &&
              toRootHex(r.payloadAttributes.parentBeaconBlockRoot) === toRootHex(m.old.data.parentBlockRoot)
          )
        ).toHaveLength(1);
        expect(m.offer(m.old)).not.toBeNull();
        expect(m.offer(m.old)).not.toBe(m.signed);
        expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledTimes(1);
        expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
        expect(m.sessions.size).toBe(1);
      } finally {
        completed.resolve();
        duties.resolve(
          mockApiResponse({
            data: [{slot: 1, validatorIndex: 3, pubkey: Buffer.alloc(48, 3)}],
            meta: {executionOptimistic: false, dependentRoot: toRootHex(dependentRoot)},
          })
        );
      }
    });

    it("releases pending A permission on A to B to A without reconstructing the promoted primary", async () => {
      const m = await started();
      const duties = defer<Awaited<ReturnType<typeof m.api.validator.getProposerDutiesV2>>>();
      m.api.validator.getProposerDutiesV2.mockReturnValueOnce(duties.promise);
      try {
        m.start(attributes(3, 40));
        m.bidder.onAlternatePayloadAttributes(m.old);
        await vi.advanceTimersByTimeAsync(1);
        expect(m.sessions.size).toBe(0);
        expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledTimes(1);
        m.start(m.old);
        await vi.advanceTimersByTimeAsync(101);
        expect(m.offer(m.old)).not.toBeNull();
        expect(m.offer(m.old)).not.toBe(m.signed);
        expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
        expect(m.payloadSource.prepare.mock.calls.filter(([r]) => r.requireRetainedOffer)).toHaveLength(0);
        expect(
          m.logger.debug.mock.calls.some(
            ([message, context]) =>
              message === "Primary bid handoff" &&
              typeof context === "object" &&
              context !== null &&
              "state" in context &&
              context.state === "fallback"
          )
        ).toBe(false);
      } finally {
        duties.resolve(
          mockApiResponse({
            data: [{slot: 1, validatorIndex: 3, pubkey: Buffer.alloc(48, 3)}],
            meta: {executionOptimistic: false, dependentRoot: toRootHex(dependentRoot)},
          })
        );
      }
    });

    it("keeps one adopted A owner across A to B to A and a later demotion", async () => {
      const m = await started();
      m.start(attributes(3, 40));
      m.bidder.onAlternatePayloadAttributes(m.old);
      await vi.advanceTimersByTimeAsync(101);
      const eligibility = m.bidStore.getOfferEligibility(m.signed);
      const oldPayload = m.payloadStore.get(toRootHex(m.signed.message.blockHash))?.payload;
      const prepare = m.payloadSource.prepare.getMockImplementation();
      const renew = m.payloadSource.renewOffer.getMockImplementation();
      if (!eligibility?.retained || !oldPayload || !prepare || !renew) throw Error("Missing adopted fixture");
      const renewed = defer<void>();
      m.payloadSource.renewOffer.mockImplementation(async (payload, signal) => {
        await renewed.promise;
        return renew(payload, signal);
      });
      m.payloadSource.prepare.mockImplementation(async (request, signal) => {
        const handle = await prepare(request, signal);
        const entry = m.sessions.get(handle.payloadId);
        if (
          entry &&
          toRootHex(request.payloadAttributes.parentBeaconBlockRoot) === toRootHex(m.old.data.parentBlockRoot)
        )
          entry.payload.executionPayload = oldPayload.executionPayload;
        return handle;
      });
      try {
        m.start(m.old);
        await vi.advanceTimersByTimeAsync(101);
        const replacement = [...m.sessions.entries()].find(
          ([, entry]) =>
            toRootHex(entry.request.payloadAttributes.parentBeaconBlockRoot) === toRootHex(m.old.data.parentBlockRoot)
        );
        if (!replacement) throw Error("Missing returned primary");
        expect(m.bidStore.getOfferEligibility(m.signed)).toBe(replacement[1].payload.offerEligibility);
        expect(m.bidStore.getOfferEligibility(m.signed)).not.toBe(eligibility);
        m.start(attributes(4, 40));
        await vi.advanceTimersByTimeAsync(101);
        expect(
          m.payloadSource.retainPrimaryPayload.mock.calls.filter(([handle]) => handle.payloadId === replacement[0])
        ).toHaveLength(0);
        expect(replacement[1].payload.offerEligibility?.lease.ready).toBe(false);
        renewed.resolve();
        await vi.advanceTimersByTimeAsync(101);
        expect(m.bidStore.getOfferEligibility(m.signed)).toBe(eligibility);
        expect(m.offer(m.old)).not.toBeNull();
        expect(eligibility.retained.closed).toBe(false);
        expect(m.payloadSource.prepare.mock.calls.filter(([r]) => r.requireRetainedOffer)).toHaveLength(0);
        expect(
          m.payloadSource.retainPrimaryPayload.mock.calls.filter(
            ([, payload]) => payload.executionPayload === oldPayload.executionPayload
          )
        ).toHaveLength(1);
        expect(m.payloadSource.releaseOffer.mock.calls.some(([p]) => p.offerEligibility === eligibility)).toBe(false);
      } finally {
        renewed.resolve();
      }
    });

    it("tracks a newer durable write completed after demotion without offering it before validation", async () => {
      const m = await started();
      const session = [...m.sessions.values()][0];
      const original = session.payload;
      const newer: BuiltPayload = {
        ...original,
        executionPayload: {...original.executionPayload, blockHash: Buffer.alloc(32, 99)},
        executionPayloadValue: original.executionPayloadValue * 2n,
      };
      const disk = defer<void>();
      m.retainCommitment.mockImplementation(async (signed) => {
        if (toRootHex(signed.message.blockHash) === toRootHex(newer.executionPayload.blockHash)) await disk.promise;
      });
      session.payload = newer;
      const offered: Array<gloas.SignedExecutionPayloadBid | null> = [];
      m.bidStore.subscribe(1, toRootHex(m.old.data.parentBlockHash), toRootHex(m.old.data.parentBlockRoot), () =>
        offered.push(m.offer(m.old))
      );
      try {
        await vi.advanceTimersByTimeAsync(100);
        m.start(attributes(3, 40));
        await vi.advanceTimersByTimeAsync(1);
        expect(m.offer(attributes(3, 40))).not.toBeNull();
        expect(m.payloadSource.retainPrimaryPayload).not.toHaveBeenCalled();
        disk.resolve();
        await vi.advanceTimersByTimeAsync(1);
        const signed = m.retainCommitment.mock.calls.find(
          ([bid]) => toRootHex(bid.message.blockHash) === toRootHex(newer.executionPayload.blockHash)
        )?.[0];
        if (!signed) throw Error("Missing newer durable signature");
        expect(m.bidStore.has(signed)).toBe(true);
        expect(m.bidStore.has(m.signed)).toBe(true);
        expect(m.payloadStore.has(toRootHex(signed.message.blockHash))).toBe(true);
        expect(m.offer(m.old)).toBeNull();
        expect(offered.every((bid) => bid === null)).toBe(true);
        expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledTimes(1);
        expect(m.payloadSource.retainPrimaryPayload.mock.calls[0][1]).toBe(newer);
        m.bidder.onAlternatePayloadAttributes(m.old);
        await vi.advanceTimersByTimeAsync(101);
        expect(m.offer(m.old)).toBe(signed);
        expect(m.payloadSource.prepare).toHaveBeenCalledTimes(2);
        expect(
          m.retainCommitment.mock.calls.filter(
            ([bid]) => toRootHex(bid.message.parentBlockRoot) === toRootHex(m.old.data.parentBlockRoot)
          )
        ).toHaveLength(2);
      } finally {
        disk.resolve();
      }
    });

    it("skips the grant when both physical workers are already occupied", async () => {
      const m = await started();
      m.payloadSource.getResources.mockReturnValue({
        capacity: 2,
        active: 2,
        preparing: 0,
        releasing: 0,
        uncertain: 0,
        alternatesDisabled: false,
      });
      m.start(attributes(3, 40));
      await vi.advanceTimersByTimeAsync(1);
      expect(m.payloadSource.retainPrimaryPayload).not.toHaveBeenCalled();
    });

    it("releases an unvalidated grant after the bounded metadata wait", async () => {
      const m = await started();
      m.start(attributes(3, 40));
      await vi.advanceTimersByTimeAsync(501);
      expect(m.offer(m.old)).toBeNull();
      expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
    });

    it("releases pending grants on shutdown", async () => {
      const m = await started();
      m.start(attributes(3, 40));
      await vi.advanceTimersByTimeAsync(1);
      controller.abort();
      await vi.advanceTimersByTimeAsync(1);
      expect(m.payloadSource.releaseOffer).toHaveBeenCalledTimes(1);
      expect(m.offer(m.old)).toBeNull();
    });

    it("counts handoffs against the four-attempt slot limit across head flaps", async () => {
      const m = await started();
      let old = m.old;
      for (let root = 3; root <= 7; root++) {
        const next = attributes(root, 40);
        m.start(next);
        m.bidder.onAlternatePayloadAttributes(old);
        await vi.advanceTimersByTimeAsync(101);
        old = next;
      }
      expect(m.payloadSource.retainPrimaryPayload).toHaveBeenCalledTimes(4);
      expect(m.payloadSource.prepare).toHaveBeenCalledTimes(6);
    });

    it("skips handoff if uncertain physical resources would compete with the new primary", async () => {
      const m = await started();
      m.payloadSource.getResources.mockReturnValue({
        capacity: 2,
        active: 1,
        preparing: 0,
        releasing: 0,
        uncertain: 1,
        alternatesDisabled: true,
      });
      m.start(attributes(3, 40));
      await vi.advanceTimersByTimeAsync(1);
      expect(m.payloadSource.retainPrimaryPayload).not.toHaveBeenCalled();
    });
  });

  it("does not hand off to a new slot or another proposer", async () => {
    for (const changed of ["slot", "proposer"]) {
      const m = setup({primaryHandoff: true}, [], true);
      m.start(attributes(1, 40));
      await vi.advanceTimersByTimeAsync(1);
      const next = attributes(3, 40);
      if (changed === "slot") {
        next.data.proposalSlot = 2;
        next.data.payloadAttributes.slotNumber = 2;
      } else next.data.proposerIndex++;
      m.start(next);
      await vi.advanceTimersByTimeAsync(1);
      expect(m.payloadSource.retainPrimaryPayload, changed).not.toHaveBeenCalled();
    }
  });

  describe("generation-aware retained alternates", () => {
    const requests = (m: ReturnType<typeof setup>) =>
      m.payloadSource.prepare.mock.calls.filter(([r]) => r.requireRetainedOffer);
    async function started() {
      const m = setup({}, [], true);
      const primary = attributes(4, 5),
        alternate = attributes(4, 6);
      m.start(primary);
      await vi.advanceTimersByTimeAsync(100);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      return {...m, primary, alternate};
    }

    it.each([false, true])(
      "same-arrival experiment preserves primary work and serves the selected old parent only with opt-in (%s)",
      async (enabled) => {
        const m = setup({}, [], true);
        m.payloadSource.supportsRetainedOffers = enabled;
        const old = attributes(4, 5),
          head = attributes(4, 6);
        await vi.advanceTimersByTimeAsync(4000);
        m.start(old);
        await vi.advanceTimersByTimeAsync(5000);
        m.start(head);
        await vi.advanceTimersByTimeAsync(100);
        m.bidder.onAlternatePayloadAttributes(old);
        await vi.advanceTimersByTimeAsync(2800);
        // The proposer reads the selected old parent at -100 ms in both runs.
        expect(Date.now()).toBe(11_900);
        const selected = m.offer(old);
        expect(selected !== null).toBe(enabled);
        if (selected) expect(selected.message.value).toBeGreaterThan(0);
        expect(m.payloadSource.prepare.mock.calls.filter(([r]) => !r.requireRetainedOffer)).toHaveLength(2);
        expect(requests(m)).toHaveLength(enabled ? 1 : 0);
        expect(m.payloadSource.getPayload.mock.calls.filter(([h]) => h.payloadId === "2")).toHaveLength(30);
        expect(m.sessions.size).toBe(1);
        expect(m.offer(head)).not.toBeNull();
        expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledTimes(1);
        expect(m.ledger.getRevisionCount(1)).toBe(enabled ? 3 : 2);
      }
    );

    it("serves a leased alternate after its worker is released without extra gossip", async () => {
      const m = await started();
      expect(requests(m)).toHaveLength(1);
      expect(m.sessions.size).toBe(1);
      const bid = m.offer(m.alternate);
      expect(bid).not.toBeNull();
      await vi.advanceTimersByTimeAsync(1500);
      expect(m.offer(m.alternate)).toBe(bid);
      expect(m.payloadSource.renewOffer.mock.calls.length).toBeGreaterThan(10);
      expect(m.api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
      expect(m.payloadSource.prepare.mock.calls.every(([r]) => !r.requireUnleased)).toBe(true);
    });

    it.each([false, true])(
      "refresh with identical bytes keeps exactly the chosen owner (higher value %s)",
      async (higher) => {
        const m = setup({alternateRefreshBeforeSlotMs: 800}, [9850], true);
        const primary = attributes(4, 5),
          alternate = attributes(4, 6);
        m.start(primary);
        await vi.advanceTimersByTimeAsync(100);
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(600);
        const old = m.offer(alternate);
        if (!old) throw Error("Missing old offer");
        const oldPayload = m.payloadStore.get(toRootHex(old.message.blockHash))?.payload;
        if (!oldPayload) throw Error("Missing old payload");
        const prepare = m.payloadSource.prepare.getMockImplementation();
        if (!prepare) throw Error("Missing prepare");
        m.payloadSource.prepare.mockImplementation(async (request, signal) => {
          const handle = await prepare(request, signal);
          if (request.requireRetainedOffer) {
            const session = m.sessions.get(handle.payloadId);
            if (!session?.payload.offerEligibility?.retained) throw Error("Missing new grant");
            session.payload.executionPayload = oldPayload.executionPayload;
            session.payload.executionPayloadValue = oldPayload.executionPayloadValue * (higher ? 2n : 1n);
            session.payload.offerEligibility.retained.blockHash = toRootHex(old.message.blockHash);
          }
          return handle;
        });
        const cleanup = defer<void>();
        const release = m.payloadSource.releaseOffer.getMockImplementation();
        if (!release) throw Error("Missing release");
        m.payloadSource.releaseOffer.mockImplementation(async (payload, signal) => {
          await release(payload, signal);
          await cleanup.promise;
        });
        await vi.advanceTimersByTimeAsync(11_050);
        const latest = m.offer(alternate);
        if (!latest) throw Error("Refresh destroyed the only offer");
        expect(toRootHex(latest.message.blockHash)).toBe(toRootHex(old.message.blockHash));
        expect(latest.message.value).toBe(old.message.value * (higher ? 2 : 1));
        expect(m.bidStore.getOfferEligibility(latest)?.retained?.id).toBe(
          higher ? "offer-fixture-3" : "offer-fixture-2"
        );
        cleanup.resolve();
        await vi.advanceTimersByTimeAsync(150);
        expect(m.offer(alternate)).toBe(latest);
        expect(requests(m)).toHaveLength(2);
        expect(m.payloadSource.releaseOffer.mock.calls.every(([p]) => p !== (higher ? undefined : oldPayload))).toBe(
          true
        );
        expect(m.sessions.size).toBe(1);
      }
    );

    it.each([false, true])(
      "shares a 20 MiB same-hash body across retained grant owners (higher value %s)",
      async (higher) => {
        const m = setup({alternateRefreshBeforeSlotMs: 800}, [9850], true);
        const primary = attributes(4, 5),
          alternate = attributes(4, 6);
        const acquired: BuiltPayload[] = [];
        const prepare = m.payloadSource.prepare.getMockImplementation();
        if (!prepare) throw Error("Missing prepare");
        m.payloadSource.prepare.mockImplementation(async (request, signal) => {
          const handle = await prepare(request, signal);
          if (request.requireRetainedOffer) {
            const payload = m.sessions.get(handle.payloadId)?.payload;
            if (!payload?.offerEligibility?.retained) throw Error("Missing grant");
            const first = acquired[0];
            if (first) {
              payload.executionPayload = ssz.gloas.ExecutionPayload.clone(first.executionPayload);
              payload.executionRequests = structuredClone(first.executionRequests);
              payload.blobsBundle = structuredClone(first.blobsBundle);
              payload.executionPayloadValue = first.executionPayloadValue * (higher ? 2n : 1n);
              payload.offerEligibility.retained.blockHash = toRootHex(first.executionPayload.blockHash);
              expect(payload.executionPayload.transactions.bytes === first.executionPayload.transactions.bytes).toBe(
                false
              );
            } else {
              // Opaque bytes exercise retention accounting, not EVM validity.
              payload.executionPayload.transactions = SerializedList.fromArray([new Uint8Array(20 * 1024 * 1024)]);
            }
            acquired.push(payload);
          }
          return handle;
        });
        m.start(primary);
        await vi.advanceTimersByTimeAsync(100);
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(600);
        const old = m.offer(alternate);
        if (!old) throw Error("Missing original offer");
        const stored = m.payloadStore.get(toRootHex(old.message.blockHash))?.payload;
        if (!stored) throw Error("Missing original payload");
        const accounted = m.payloadStore.bytes;
        const cleanup = defer<void>();
        const release = m.payloadSource.releaseOffer.getMockImplementation();
        if (!release) throw Error("Missing release");
        m.payloadSource.releaseOffer.mockImplementation(async (payload, signal) => {
          await release(payload, signal);
          await cleanup.promise;
        });
        await vi.advanceTimersByTimeAsync(11_050);
        expect(acquired).toHaveLength(2);
        expect(m.payloadStore.bytes).toBe(accounted);
        expect(accounted).toBeLessThan(32 * 1024 * 1024);
        for (const payload of acquired) {
          expect(payload.executionPayload === stored.executionPayload, "retained owner body").toBe(true);
          expect(payload.executionRequests === stored.executionRequests, "retained owner requests").toBe(true);
          expect(payload.blobsBundle === stored.blobsBundle, "retained owner sidecars").toBe(true);
        }
        expect(acquired[1].offerEligibility).not.toBe(acquired[0].offerEligibility);
        expect(acquired[1].executionPayloadValue).toBe(stored.executionPayloadValue * (higher ? 2n : 1n));
        const latest = m.offer(alternate);
        if (!latest) throw Error("Missing refreshed offer");
        expect(latest.message.value).toBe(old.message.value * (higher ? 2 : 1));
        expect(m.bidStore.getOfferEligibility(latest)?.retained?.id).toBe(
          higher ? "offer-fixture-3" : "offer-fixture-2"
        );
        cleanup.resolve();
        await vi.advanceTimersByTimeAsync(150);
        const renewed = m.payloadSource.renewOffer.mock.calls.at(-1)?.[0];
        expect(renewed?.executionPayload.transactions.bytes === stored.executionPayload.transactions.bytes).toBe(true);
        expect(m.bidStore.has(old)).toBe(true);
        expect(m.payloadStore.get(toRootHex(old.message.blockHash))?.payload).toBe(stored);
      }
    );

    it("uses canonical shared blob sidecars in the retained renewal closure", async () => {
      const m = setup({}, [], true);
      const primary = attributes(4, 5),
        alternate = attributes(4, 6);
      const prepare = m.payloadSource.prepare.getMockImplementation();
      if (!prepare) throw Error("Missing prepare");
      m.payloadSource.prepare.mockImplementation(async (request, signal) => {
        const handle = await prepare(request, signal);
        const payload = m.sessions.get(handle.payloadId)?.payload;
        if (!payload) throw Error("Missing payload");
        payload.blobsBundle = {
          blobs: [new Uint8Array(131072).fill(1)],
          commitments: [new Uint8Array(48).fill(2)],
          proofs: Array.from({length: 128}, () => new Uint8Array(48).fill(3)),
        };
        return handle;
      });
      m.start(primary);
      await vi.advanceTimersByTimeAsync(100);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(800);
      const primaryBid = m.offer(primary),
        alternateBid = m.offer(alternate);
      if (!primaryBid || !alternateBid) throw Error("Missing bid");
      const primaryPayload = m.payloadStore.get(toRootHex(primaryBid.message.blockHash))?.payload;
      const alternatePayload = m.payloadStore.get(toRootHex(alternateBid.message.blockHash))?.payload;
      const renewed = m.payloadSource.renewOffer.mock.calls.at(-1)?.[0];
      if (!primaryPayload || !alternatePayload || !renewed) throw Error("Missing retained payload");
      expect(alternatePayload.blobsBundle.blobs[0]).toBe(primaryPayload.blobsBundle.blobs[0]);
      expect(renewed.blobsBundle === alternatePayload.blobsBundle).toBe(true);
      expect(renewed.blobsBundle.commitments[0]).toBe(primaryPayload.blobsBundle.commitments[0]);
      expect(renewed.blobsBundle.proofs[127]).toBe(primaryPayload.blobsBundle.proofs[127]);
      expect(renewed.offerEligibility).toBe(m.bidStore.getOfferEligibility(alternateBid));
      expect(renewed.offerEligibility).not.toBe(primaryPayload.offerEligibility);
      expect(m.payloadStore.bytes).toBeLessThan(2 * 131072);
      expect(m.sessions.size).toBe(1);
    });

    it.each([false, true])("keeps a lapsed incumbent over a non-improving refresh (equal %s)", async (equal) => {
      const m = setup({alternateRefreshBeforeSlotMs: 800}, [9850], true);
      const primary = attributes(4, 5),
        alternate = attributes(4, 6);
      m.start(primary);
      await vi.advanceTimersByTimeAsync(100);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      const old = m.offer(alternate);
      if (!old) throw Error("Missing incumbent");
      const oldEligibility = m.bidStore.getOfferEligibility(old);
      if (!oldEligibility?.retained) throw Error("Missing incumbent grant");
      const prepare = m.payloadSource.prepare.getMockImplementation();
      const renew = m.payloadSource.renewOffer.getMockImplementation();
      if (!prepare || !renew) throw Error("Missing source");
      m.payloadSource.prepare.mockImplementation(async (request, signal) => {
        const handle = await prepare(request, signal);
        if (request.requireRetainedOffer && !equal) {
          const session = m.sessions.get(handle.payloadId);
          if (!session) throw Error("Missing refresh");
          session.payload.executionPayloadValue = BigInt(old.message.value - 1) * 1_000_000_000n;
        }
        return handle;
      });
      let lapse = true;
      m.payloadSource.renewOffer.mockImplementation(async (payload, signal) => {
        if (lapse && payload.offerEligibility === oldEligibility) {
          oldEligibility.lease.ready = false;
          return false;
        }
        return renew(payload, signal);
      });
      oldEligibility.lease.ready = false;
      await vi.advanceTimersByTimeAsync(11_050);
      expect(requests(m)).toHaveLength(2);
      expect(m.offer(alternate)).toBeNull();
      expect(oldEligibility.retained.closed).toBe(false);
      expect(
        m.ledger.getBidsForSlot(1).filter((b) => b.parentBlockHash === toRootHex(alternate.data.parentBlockHash))
      ).toHaveLength(1);
      lapse = false;
      await vi.advanceTimersByTimeAsync(101);
      expect(m.offer(alternate)).toBe(old);
      expect(m.bidStore.getOfferEligibility(old)).toBe(oldEligibility);
    });

    it("does not spend repeated attempts on attributes for a recorded but unadopted tuple", async () => {
      const m = setup({}, [], true);
      const alternate = attributes(4, 6);
      m.start(attributes(4, 5));
      await vi.advanceTimersByTimeAsync(100);
      const disk = defer<void>();
      m.retainCommitment.mockImplementationOnce(() => disk.promise);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      disk.resolve();
      await vi.advanceTimersByTimeAsync(100);
      const recorded = m.ledger
        .getBidsForSlot(1)
        .filter((bid) => bid.parentBlockHash === toRootHex(alternate.data.parentBlockHash));
      expect(recorded).toHaveLength(1);
      expect(m.offer(alternate)).toBeNull();
      for (let i = 0; i < 5; i++) {
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(600);
      }
      expect(requests(m)).toHaveLength(1);
      const distinct = attributes(4, 7);
      m.bidder.onAlternatePayloadAttributes(distinct);
      await vi.advanceTimersByTimeAsync(600);
      expect(requests(m)).toHaveLength(2);
      expect(m.offer(distinct)).not.toBeNull();
    });

    it("does not rebuild a live owner during a temporary lease lapse or repeated attributes", async () => {
      const m = await started();
      const bid = m.offer(m.alternate);
      if (!bid) throw Error("Missing offer");
      const lease = m.bidStore.getOfferEligibility(bid)?.lease;
      if (!lease) throw Error("Missing lease");
      lease.ready = false;
      lease.validUntilUnixMs = Date.now();
      m.bidder.onAlternatePayloadAttributes(m.alternate);
      await vi.advanceTimersByTimeAsync(150);
      expect(m.offer(m.alternate)).toBe(bid);
      expect(requests(m)).toHaveLength(1);
      expect(m.payloadSource.releaseOffer).not.toHaveBeenCalled();
    });

    it("does not reinterpret an aborted context owner as a terminal source renewal", async () => {
      const m = await started();
      const renew = m.payloadSource.renewOffer.getMockImplementation();
      if (!renew) throw Error("Missing renew");
      const completion = defer<void>();
      m.payloadSource.renewOffer.mockImplementation(async (payload, signal) => {
        await completion.promise;
        return renew(payload, signal);
      });
      await vi.advanceTimersByTimeAsync(101);
      const unavailable = attributes(4, 6);
      unavailable.context.builders[0].active = false;
      m.bidder.onAlternatePayloadAttributes(unavailable);
      m.bidder.onAlternatePayloadAttributes(m.alternate);
      completion.resolve();
      await vi.advanceTimersByTimeAsync(800);
      expect(requests(m)).toHaveLength(1);
      expect(m.offer(m.alternate)).toBeNull();
    });

    it("keeps exact retained permission when an identical signed root briefly uses a primary lease", async () => {
      const m = await started();
      const bid = m.offer(m.alternate);
      if (!bid) throw Error("Missing alternate");
      const oldPayload = m.payloadStore.get(toRootHex(bid.message.blockHash))?.payload;
      const eligibility = m.bidStore.getOfferEligibility(bid);
      if (!oldPayload || !eligibility) throw Error("Missing retained permission");
      const renewed = defer<void>();
      const renew = m.payloadSource.renewOffer.getMockImplementation();
      const prepare = m.payloadSource.prepare.getMockImplementation();
      if (!renew || !prepare) throw Error("Missing source");
      m.payloadSource.renewOffer.mockImplementation(async (payload, signal) => {
        await renewed.promise;
        return renew(payload, signal);
      });
      m.payloadSource.prepare.mockImplementation(async (request, signal) => {
        const handle = await prepare(request, signal);
        const entry = m.sessions.get(handle.payloadId);
        if (entry && request.forkchoiceState.headBlockHash === toRootHex(m.alternate.data.parentBlockHash))
          entry.payload.executionPayload = oldPayload.executionPayload;
        return handle;
      });
      m.start(m.alternate);
      await vi.advanceTimersByTimeAsync(101);
      expect(m.offer(m.alternate)).not.toBeNull();
      expect(m.bidStore.getOfferEligibility(bid)).not.toBe(eligibility);
      m.start(attributes(8, 9));
      await vi.advanceTimersByTimeAsync(101);
      renewed.resolve();
      await vi.advanceTimersByTimeAsync(101);
      expect(m.offer(m.alternate)).not.toBeNull();
      expect(m.bidStore.getOfferEligibility(bid)).toBe(eligibility);
      expect(requests(m)).toHaveLength(1);
    });

    it("resumes a late same-context head switch immediately after duties resolve", async () => {
      const m = await started();
      const bid = m.offer(m.alternate);
      await vi.advanceTimersByTimeAsync(11_100);
      const response = await m.api.validator.getProposerDutiesV2({epoch: 0});
      const duties = defer<typeof response>();
      m.api.validator.getProposerDutiesV2.mockReturnValueOnce(duties.promise);
      m.start(attributes(8, 9));
      expect(m.offer(m.alternate)).toBeNull();
      await vi.advanceTimersByTimeAsync(51);
      expect(m.offer(m.alternate)).toBeNull();
      const count = m.payloadSource.renewOffer.mock.calls.length;
      duties.resolve(response);
      await vi.advanceTimersByTimeAsync(1);
      expect(m.offer(m.alternate)).toBe(bid);
      expect(m.payloadSource.renewOffer.mock.calls.length).toBe(count + 1);
      expect(requests(m)).toHaveLength(1);
    });

    it.each([false, true])(
      "retries generation-not-ready acquisition once within the existing cap (persistent %s)",
      async (persistent) => {
        const m = setup({}, [], true);
        const get = m.payloadSource.getPayload.getMockImplementation();
        if (!get) throw Error("Missing get");
        let failures = 0;
        m.payloadSource.getPayload.mockImplementation(async (handle, signal) => {
          if (m.sessions.get(handle.payloadId)?.request.requireRetainedOffer && (persistent || failures === 0)) {
            failures++;
            throw new PayloadSourceNotReady();
          }
          return get(handle, signal);
        });
        m.start(attributes(4, 5));
        await vi.advanceTimersByTimeAsync(100);
        const alternate = attributes(4, 6);
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(1200);
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(600);
        expect(requests(m)).toHaveLength(2);
        expect(m.offer(alternate) === null).toBe(persistent);
        expect(m.sessions.size).toBe(1);
      }
    );

    it("rebuilds a superseded leased primary only from authoritative alternate attributes", async () => {
      const m = setup({}, [], true);
      const old = attributes(4, 5),
        head = attributes(4, 6);
      m.start(old);
      await vi.advanceTimersByTimeAsync(100);
      const oldBid = m.offer(old);
      expect(oldBid).not.toBeNull();
      if (!oldBid) throw Error("Missing old offer");
      m.start(head);
      await vi.advanceTimersByTimeAsync(200);
      expect(m.offer(old)).toBeNull();
      expect(requests(m)).toHaveLength(0);
      m.bidder.onAlternatePayloadAttributes(old);
      await vi.advanceTimersByTimeAsync(600);
      expect(requests(m)).toHaveLength(1);
      expect(m.offer(old)).not.toBeNull();
      expect(m.offer(old)).not.toBe(oldBid);
      expect(m.payloadStore.get(toRootHex(oldBid.message.blockHash))).toBeDefined();
      expect(m.sessions.size).toBe(1);
    });

    it("cancels old permission and reconstructs a lower-value offer in the next generation", async () => {
      const m = await started();
      const oldBid = m.offer(m.alternate);
      if (!oldBid) throw Error("Missing old offer");
      const oldPayload = m.payloadStore.get(toRootHex(oldBid.message.blockHash))?.payload;
      if (!oldPayload) throw Error("Missing stored payload");
      const prepare = m.payloadSource.prepare.getMockImplementation();
      if (!prepare) throw Error("Missing prepare");
      m.payloadSource.prepare.mockImplementation(async (request, signal) => {
        const handle = await prepare(request, signal);
        if (request.requireRetainedOffer) {
          const session = m.sessions.get(handle.payloadId);
          if (!session) throw Error("Missing alternate");
          session.payload.executionPayloadValue = 1n;
        }
        return handle;
      });
      m.advanceGeneration();
      await vi.advanceTimersByTimeAsync(101);
      expect(m.bidStore.canOffer(oldBid)).toBe(false);
      expect(m.payloadStore.get(toRootHex(oldBid.message.blockHash))?.payload).toBe(oldPayload);
      await vi.advanceTimersByTimeAsync(600);
      const current = m.offer(m.alternate);
      if (!current) throw Error("Missing new offer");
      expect(current).not.toBeNull();
      expect(current.message.value).toBeLessThan(oldBid.message.value);
      expect(m.bidStore.getOfferEligibility(current)?.generation).toBe("0x1");
      expect(requests(m)).toHaveLength(2);
      expect(m.bidStore.has(oldBid)).toBe(true);
    });

    it("reconstructs a fenced tuple after it stops being primary without spending repeated attempts", async () => {
      const m = await started();
      const old = m.offer(m.alternate);
      if (!old) throw Error("Missing old offer");
      m.start(m.alternate);
      await vi.advanceTimersByTimeAsync(101);
      m.advanceGeneration();
      await vi.advanceTimersByTimeAsync(101);
      expect(requests(m)).toHaveLength(1);
      m.start(m.primary);
      await vi.advanceTimersByTimeAsync(700);
      const current = m.offer(m.alternate);
      if (!current) throw Error("Missing reconstructed offer");
      expect(m.bidStore.getOfferEligibility(current)?.generation).toBe("0x1");
      expect(requests(m)).toHaveLength(2);
      expect(m.payloadStore.has(toRootHex(old.message.blockHash))).toBe(true);
      for (let n = 0; n < 3; n++) m.bidder.onAlternatePayloadAttributes(m.alternate);
      await vi.advanceTimersByTimeAsync(600);
      expect(requests(m)).toHaveLength(2);
      expect(m.sessions.size).toBe(1);
    });

    it("preserves a fenced reconstruction while cleanup finishes with unresolved primary duties", async () => {
      const m = await started();
      const release = m.payloadSource.releaseOffer.getMockImplementation();
      if (!release) throw Error("Missing release");
      const cleanup = defer<void>();
      m.payloadSource.releaseOffer.mockImplementation(async (payload, signal) => {
        await cleanup.promise;
        await release(payload, signal);
      });
      m.advanceGeneration();
      await vi.advanceTimersByTimeAsync(101);
      const response = await m.api.validator.getProposerDutiesV2({epoch: 0});
      const duties = defer<typeof response>();
      m.api.validator.getProposerDutiesV2.mockReturnValueOnce(duties.promise);
      m.start(attributes(8, 9));
      cleanup.resolve();
      await vi.advanceTimersByTimeAsync(100);
      expect(requests(m)).toHaveLength(1);
      duties.resolve(response);
      await vi.advanceTimersByTimeAsync(700);
      const current = m.offer(m.alternate);
      if (!current) throw Error("Missing reconstructed offer");
      expect(m.bidStore.getOfferEligibility(current)?.generation).toBe("0x1");
      expect(requests(m)).toHaveLength(2);
      expect(m.sessions.size).toBe(1);
    });

    it("preserves a fenced reconstruction until a full invalid queue is pruned", async () => {
      const m = await started();
      m.canRetainAlternate.mockReturnValue(false);
      for (let n = 0; n < 4; n++) {
        const other = attributes(20 + n, 30 + n);
        other.context.dependentRoot = Buffer.alloc(32, 99);
        m.bidder.onAlternatePayloadAttributes(other);
      }
      m.advanceGeneration();
      await vi.advanceTimersByTimeAsync(101);
      expect(requests(m)).toHaveLength(1);
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(800);
      const current = m.offer(m.alternate);
      if (!current) throw Error("Missing reconstructed offer");
      expect(m.bidStore.getOfferEligibility(current)?.generation).toBe("0x1");
      expect(requests(m)).toHaveLength(2);
      expect(m.sessions.size).toBe(1);
    });

    it("preserves a fenced reconstruction while no primary is available", async () => {
      const m = await started();
      const release = m.payloadSource.releaseOffer.getMockImplementation();
      if (!release) throw Error("Missing release");
      const cleanup = defer<void>();
      m.payloadSource.releaseOffer.mockImplementation(async (payload, signal) => {
        await cleanup.promise;
        await release(payload, signal);
      });
      m.advanceGeneration();
      await vi.advanceTimersByTimeAsync(101);
      m.api.validator.getProposerDutiesV2.mockRejectedValueOnce(Error("Duties unavailable"));
      m.start(attributes(8, 9));
      await vi.advanceTimersByTimeAsync(101);
      cleanup.resolve();
      await vi.advanceTimersByTimeAsync(100);
      expect(m.sessions.size).toBe(0);
      expect(requests(m)).toHaveLength(1);
      m.start(m.primary);
      await vi.advanceTimersByTimeAsync(700);
      const current = m.offer(m.alternate);
      if (!current) throw Error("Missing reconstructed offer");
      expect(m.bidStore.getOfferEligibility(current)?.generation).toBe("0x1");
      expect(requests(m)).toHaveLength(2);
      expect(m.sessions.size).toBe(1);
    });

    it("consumes a deferred reconstruction once even when its new construction fails", async () => {
      const m = await started();
      m.start(m.alternate);
      await vi.advanceTimersByTimeAsync(101);
      m.advanceGeneration();
      await vi.advanceTimersByTimeAsync(101);
      const prepare = m.payloadSource.prepare.getMockImplementation();
      if (!prepare) throw Error("Missing prepare");
      m.payloadSource.prepare.mockImplementation(async (request, signal) => {
        if (request.requireRetainedOffer) throw Error("Construction failed");
        return prepare(request, signal);
      });
      m.start(m.primary);
      await vi.advanceTimersByTimeAsync(700);
      for (let n = 0; n < 3; n++) {
        m.bidder.onAlternatePayloadAttributes(m.alternate);
        await vi.advanceTimersByTimeAsync(600);
      }
      expect(requests(m)).toHaveLength(2);
      expect(m.offer(m.alternate)).toBeNull();
      expect(m.sessions.size).toBe(1);
    });

    it("discards a deferred reconstruction after authoritative branch eligibility changes", async () => {
      const m = await started();
      m.start(m.alternate);
      await vi.advanceTimersByTimeAsync(101);
      m.advanceGeneration();
      await vi.advanceTimersByTimeAsync(101);
      const unavailable = attributes(4, 6);
      unavailable.context.builders[0].active = false;
      m.bidder.onAlternatePayloadAttributes(unavailable);
      m.start(m.primary);
      await vi.advanceTimersByTimeAsync(700);
      m.bidder.onAlternatePayloadAttributes(m.alternate);
      await vi.advanceTimersByTimeAsync(600);
      expect(requests(m)).toHaveLength(1);
      expect(m.offer(m.alternate)).toBeNull();
    });

    it.each([false, true])(
      "accepts a lower refresh before the fenced incumbent renews only in its namespace (same %s)",
      async (sameNamespace) => {
        const m = setup({alternateRefreshBeforeSlotMs: 800}, [9850], true);
        const alternate = attributes(4, 6);
        m.start(attributes(4, 5));
        await vi.advanceTimersByTimeAsync(100);
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(600);
        const old = m.offer(alternate);
        if (!old) throw Error("Missing old offer");
        const oldEligibility = m.bidStore.getOfferEligibility(old);
        const prepare = m.payloadSource.prepare.getMockImplementation();
        const renew = m.payloadSource.renewOffer.getMockImplementation();
        if (!oldEligibility?.retained || !prepare || !renew) throw Error("Missing source");
        m.payloadSource.prepare.mockImplementation(async (request, signal) => {
          const handle = await prepare(request, signal);
          if (request.requireRetainedOffer) {
            const payload = m.sessions.get(handle.payloadId)?.payload;
            if (!payload?.offerEligibility?.retained) throw Error("Missing refresh");
            payload.executionPayloadValue = BigInt(old.message.value - 1) * 1_000_000_000n;
            if (!sameNamespace) payload.offerEligibility.retained.namespace = "other-namespace";
          }
          return handle;
        });
        m.payloadSource.renewOffer.mockImplementation(async (payload, signal) => {
          if (payload.offerEligibility === oldEligibility) {
            oldEligibility.lease.ready = false;
            return false;
          }
          return renew(payload, signal);
        });
        m.advanceGeneration();
        await vi.advanceTimersByTimeAsync(11_050);
        expect(requests(m)).toHaveLength(2);
        const current = m.offer(alternate);
        expect(current !== null).toBe(sameNamespace);
        if (current) {
          expect(current.message.value).toBeGreaterThan(0);
          expect(current.message.value).toBeLessThan(old.message.value);
          expect(m.bidStore.getOfferEligibility(current)?.generation).toBe("0x1");
        }
        expect(m.payloadStore.has(toRootHex(old.message.blockHash))).toBe(true);
        expect(m.sessions.size).toBe(1);
      }
    );

    it("replaces a fenced incumbent while its last local lease is still valid", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 800}, [9850], true);
      const alternate = attributes(4, 6);
      m.start(attributes(4, 5));
      await vi.advanceTimersByTimeAsync(100);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      const old = m.offer(alternate);
      if (!old) throw Error("Missing old offer");
      const eligibility = m.bidStore.getOfferEligibility(old);
      const get = m.payloadSource.getPayload.getMockImplementation();
      const renew = m.payloadSource.renewOffer.getMockImplementation();
      if (!eligibility?.retained || !get || !renew) throw Error("Missing source");
      const pendingRenewal = defer<void>();
      m.payloadSource.getPayload.mockImplementation(async (handle, signal) => {
        const session = m.sessions.get(handle.payloadId);
        if (session?.request.requireRetainedOffer) {
          const refreshed = session.payload.offerEligibility;
          if (!refreshed) throw Error("Missing refresh grant");
          refreshed.generation = refreshed.lease.generation = "0x1";
          session.payload.executionPayloadValue = BigInt(old.message.value - 1) * 1_000_000_000n;
          expect(m.bidStore.canOffer(old), "previous local lease has not expired").toBe(true);
        }
        return get(handle, signal);
      });
      await vi.advanceTimersByTimeAsync(10_800);
      expect(Date.now()).toBe(11_500);
      expect(m.bidStore.canOffer(old)).toBe(true);
      m.advanceGeneration();
      m.payloadSource.renewOffer.mockImplementation(async (payload, signal) => {
        if (payload.offerEligibility === eligibility) await pendingRenewal.promise;
        return renew(payload, signal);
      });
      await vi.advanceTimersByTimeAsync(200);
      pendingRenewal.resolve();
      await vi.advanceTimersByTimeAsync(1);
      const current = m.offer(alternate);
      if (!current) throw Error("Missing lower-value current-generation offer");
      expect(current.message.value).toBeGreaterThan(0);
      expect(current.message.value).toBeLessThan(old.message.value);
      expect(m.bidStore.getOfferEligibility(current)?.generation).toBe("0x1");
      expect(m.bidStore.canOffer(old)).toBe(false);
      expect(m.payloadStore.has(toRootHex(old.message.blockHash))).toBe(true);
      expect(requests(m)).toHaveLength(2);
      expect(m.sessions.size).toBe(1);
    });

    it("does not reauthorize another eligible bid during a fenced refresh", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 800}, [9850], true);
      const alternate = attributes(4, 6);
      m.start(attributes(4, 5));
      await vi.advanceTimersByTimeAsync(100);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      const old = m.offer(alternate);
      if (!old) throw Error("Missing incumbent");
      const oldEligibility = m.bidStore.getOfferEligibility(old);
      const oldPayload = m.payloadStore.get(toRootHex(old.message.blockHash))?.payload;
      const get = m.payloadSource.getPayload.getMockImplementation();
      const renew = m.payloadSource.renewOffer.getMockImplementation();
      if (!oldEligibility?.retained || !oldPayload || !get || !renew) throw Error("Missing source");
      const pendingRenewal = defer<void>();
      m.payloadSource.getPayload.mockImplementation(async (handle, signal) => {
        const session = m.sessions.get(handle.payloadId);
        if (session?.request.requireRetainedOffer) {
          const refreshed = session.payload.offerEligibility;
          if (!refreshed) throw Error("Missing refresh grant");
          refreshed.generation = refreshed.lease.generation = "0x1";
          session.payload.executionPayloadValue = BigInt(old.message.value - 1) * 1_000_000_000n;
        }
        return get(handle, signal);
      });
      await vi.advanceTimersByTimeAsync(10_800);
      const blockHash = Buffer.alloc(32, 42);
      m.payloadStore.add({
        slot: 1,
        parentBlockRoot: alternate.data.parentBlockRoot,
        blockHash: toRootHex(blockHash),
        payload: {...oldPayload, executionPayload: {...oldPayload.executionPayload, blockHash}},
      });
      const other = await m.bidPublisher.prepare(
        {...old.message, blockHash, value: old.message.value - 1},
        undefined,
        m.payloadStore.get(toRootHex(blockHash)) ?? undefined
      );
      const otherEligibility = {
        generation: "0x0",
        lease: {
          generation: "0x0",
          ready: true,
          validUntil: performance.now() + 250,
          validUntilUnixMs: Date.now() + 250,
        },
      };
      m.bidStore.add(other, otherEligibility);
      expect(m.offer(alternate)).toBe(old);
      expect(m.bidStore.canOffer(other)).toBe(true);
      m.advanceGeneration();
      m.payloadSource.renewOffer.mockImplementation(async (payload, signal) => {
        if (payload.offerEligibility === oldEligibility) await pendingRenewal.promise;
        return renew(payload, signal);
      });
      await vi.advanceTimersByTimeAsync(200);
      pendingRenewal.resolve();
      await vi.advanceTimersByTimeAsync(300);
      expect(m.bidStore.canOffer(other), "a new grant cannot renew another payload's bid").toBe(false);
      expect(m.bidStore.getOfferEligibility(other)).toBe(otherEligibility);
      expect(m.payloadStore.has(toRootHex(other.message.blockHash))).toBe(true);
      expect(requests(m)).toHaveLength(2);
      expect(m.sessions.size).toBe(1);
    });

    it("reconstructs after a fenced replacement fails before adoption", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 1600}, [9850], true);
      const alternate = attributes(4, 6);
      m.start(attributes(4, 5));
      await vi.advanceTimersByTimeAsync(100);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      const old = m.offer(alternate);
      if (!old) throw Error("Missing incumbent");
      const eligibility = m.bidStore.getOfferEligibility(old);
      const get = m.payloadSource.getPayload.getMockImplementation();
      const renew = m.payloadSource.renewOffer.getMockImplementation();
      if (!eligibility?.retained || !get || !renew) throw Error("Missing source");
      const pendingRenewal = defer<void>();
      m.payloadSource.getPayload.mockImplementation(async (handle, signal) => {
        const session = m.sessions.get(handle.payloadId);
        if (session?.request.requireRetainedOffer) {
          const refreshed = session.payload.offerEligibility;
          if (!refreshed) throw Error("Missing refresh grant");
          refreshed.generation = refreshed.lease.generation = "0x1";
          session.payload.executionPayloadValue = BigInt(old.message.value - 1) * 1_000_000_000n;
        }
        return get(handle, signal);
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(Date.now()).toBe(10_700);
      expect(m.bidStore.canOffer(old)).toBe(true);
      m.advanceGeneration();
      m.payloadSource.renewOffer.mockImplementation(async (payload, signal) => {
        if (payload.offerEligibility === eligibility) await pendingRenewal.promise;
        return renew(payload, signal);
      });
      m.retainCommitment.mockRejectedValueOnce(Error("Journal unavailable"));
      await vi.advanceTimersByTimeAsync(60);
      expect(m.bidStore.canOffer(old)).toBe(false);
      expect(eligibility.retained.closed).toBe(false);
      expect(m.offer(alternate)).toBeNull();
      pendingRenewal.resolve();
      await vi.advanceTimersByTimeAsync(700);
      const current = m.offer(alternate);
      if (!current) throw Error("Missing reconstructed offer");
      expect(m.bidStore.getOfferEligibility(current)?.generation).toBe("0x1");
      expect(current.message.value).toBeGreaterThan(0);
      expect(current.message.value).toBeLessThan(old.message.value);
      expect(m.payloadStore.has(toRootHex(old.message.blockHash))).toBe(true);
      expect(requests(m)).toHaveLength(3);
      expect(m.sessions.size).toBe(1);
    });

    it("bounds repeated cancellation reauthorizations by the existing four-attempt cap", async () => {
      const m = await started();
      for (let n = 0; n < 7; n++) {
        m.advanceGeneration();
        await vi.advanceTimersByTimeAsync(700);
      }
      expect(requests(m)).toHaveLength(4);
      expect(m.offer(m.alternate)).toBeNull();
      expect(m.sessions.size).toBe(1);
    });

    it.each(["collateral", "builder", "preferences", "dependent root"] as const)(
      "revokes retained permission when %s changes",
      async (kind) => {
        const m = await started();
        const bid = m.offer(m.alternate);
        if (!bid) throw Error("Missing alternate offer");
        if (kind === "collateral" || kind === "builder") {
          const event = attributes(4, 6);
          if (kind === "collateral") event.context.builders[0].availableGwei = 1;
          else event.context.builders[0].active = false;
          m.bidder.onAlternatePayloadAttributes(event);
        } else if (kind === "preferences") {
          vi.spyOn(m.proposerPreferencesTracker, "get").mockReturnValue(null);
        } else {
          m.api.validator.getProposerDutiesV2.mockResolvedValue(
            mockApiResponse({
              data: [{slot: 1, validatorIndex: 3, pubkey: Buffer.alloc(48, 3)}],
              meta: {executionOptimistic: false, dependentRoot: toRootHex(Buffer.alloc(32, 9))},
            })
          );
          m.start(attributes(8, 9));
        }
        await vi.advanceTimersByTimeAsync(150);
        expect(m.offer(m.alternate)).toBeNull();
        expect(m.bidStore.has(bid)).toBe(true);
        expect(m.payloadStore.get(toRootHex(bid.message.blockHash))).toBeDefined();
        expect(m.payloadSource.releaseOffer).toHaveBeenCalled();
      }
    );

    it("keeps permission across a same-context primary preemption after alternate cleanup", async () => {
      const m = await started();
      const bid = m.offer(m.alternate);
      m.start(attributes(8, 9));
      await vi.advanceTimersByTimeAsync(600);
      expect(m.offer(m.alternate)).toBe(bid);
      expect(requests(m)).toHaveLength(1);
      expect(m.sessions.size).toBe(1);
    });

    it("retries a preempted alternate only after its physical cleanup", async () => {
      const m = setup({}, [], true);
      m.start(attributes(4, 5));
      await vi.advanceTimersByTimeAsync(100);
      m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
      await vi.advanceTimersByTimeAsync(100);
      m.start(attributes(8, 9));
      await vi.advanceTimersByTimeAsync(800);
      expect(requests(m)).toHaveLength(2);
      expect(m.offer(attributes(4, 6))).not.toBeNull();
      expect(m.sessions.size).toBe(1);
      expect(m.payloadSource.release.mock.calls.map(([h]) => h.payloadId)).toContain("2");
    });

    it("stops renewals at the publication cutoff and retains the reveal", async () => {
      const m = await started();
      const bid = m.offer(m.alternate);
      if (!bid) throw Error("Missing alternate offer");
      await vi.advanceTimersByTimeAsync(13_000);
      expect(m.offer(m.alternate)).toBeNull();
      const count = m.payloadSource.renewOffer.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(m.payloadSource.renewOffer).toHaveBeenCalledTimes(count);
      expect(m.bidStore.has(bid)).toBe(true);
      expect(m.payloadStore.get(toRootHex(bid.message.blockHash))).toBeDefined();
    });
  });

  describe("one refresh before the slot", () => {
    const alternateRequests = (m: ReturnType<typeof setup>) =>
      m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased);

    it.each([-1, 499, 5001, 750.5, NaN, Infinity])("rejects refresh offset %s", (value) => {
      expect(() => setup({alternateRefreshBeforeSlotMs: value})).toThrow("alternateRefreshBeforeSlotMs");
    });

    it("requires alternate branches", () => {
      expect(() => setup({alternateBranches: false, alternateRefreshBeforeSlotMs: 750})).toThrow(
        "ALTERNATE_REFRESH_REQUIRES_ALTERNATE_BRANCHES"
      );
    });

    it.each([0, 750])("refreshes an old primary only when enabled (%s ms)", async (lead) => {
      const m = setup({alternateRefreshBeforeSlotMs: lead, deadlineBps: 9250});
      const old = attributes(33, 44);
      m.start(old);
      await vi.advanceTimersByTimeAsync(2000);
      const previous = m.offer(old);
      if (!previous) throw Error("Missing old primary offer");
      m.start(attributes(4, 5));
      await vi.advanceTimersByTimeAsync(350);
      m.start(attributes(4, 6));
      m.bidder.onAlternatePayloadAttributes(old);
      await vi.advanceTimersByTimeAsync(8900);
      expect(alternateRequests(m)).toHaveLength(lead ? 1 : 0);
      for (const session of m.sessions.values()) {
        if (session.request.requireUnleased)
          session.payload = {...session.payload, executionPayloadValue: 2_000_000_000_000_000_000n};
      }
      await vi.advanceTimersByTimeAsync(350);
      expect(m.offer(old)?.message.value).toBe(lead ? 1_800_000_000 : 900_000_000);
      expect(m.payloadStore.has(toRootHex(previous.message.blockHash))).toBe(true);
      const current = m.offer(old);
      if (!current) throw Error("Missing current offer");
      expect(m.payloadStore.has(toRootHex(current.message.blockHash))).toBe(true);
      expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
      expect(
        toRootHex(
          m.api.beacon.publishExecutionPayloadBid.mock.calls[0][0].signedExecutionPayloadBid.message.parentBlockHash
        )
      ).toBe(toRootHex(attributes(4, 6).data.parentBlockHash));
      expect(m.sessions.size).toBe(1);
    });

    it("wakes without a new primary revision and fits the live Plataberget gossip schedule", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 800, deadlineBps: 9250}, [9850, 10000, 10400, 10800]);
      const alternate = attributes(3, 4);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(11_199);
      expect(alternateRequests(m)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(alternateRequests(m)).toHaveLength(2);
      expect(m.sessions.size).toBe(2);
      const refreshed = [...m.sessions.values()].find((session) => session.request.requireUnleased);
      if (!refreshed) throw Error("Missing refresh session");
      refreshed.payload = {...refreshed.payload, executionPayloadValue: 2_000_000_000_000_000_000n};
      await vi.advanceTimersByTimeAsync(350);
      expect(m.offer(alternate)?.message.value).toBe(1_800_000_000);
      expect(Date.now()).toBe(11_550);
      await vi.advanceTimersByTimeAsync(400);
      m.bidder.onAlternatePayloadAttributes(alternate);
      expect(alternateRequests(m)).toHaveLength(2);
      expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
      expect(m.sessions.size).toBe(1);
    });

    it.each(["timer jitter", "busy journal"] as const)("fits an 800 ms lead after %s", async (delay) => {
      const m = setup({alternateRefreshBeforeSlotMs: 800, deadlineBps: 9250}, [9850, 10000, 10400, 10800]);
      const alternate = attributes(33, 44);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(11_199);
      if (delay === "timer jitter") {
        vi.setSystemTime(11_229);
        await vi.advanceTimersByTimeAsync(1);
      } else {
        m.canRetainAlternate.mockReturnValue(false);
        await vi.advanceTimersByTimeAsync(31);
        expect(alternateRequests(m)).toHaveLength(1);
        m.canRetainAlternate.mockReturnValue(true);
        await vi.advanceTimersByTimeAsync(20);
      }
      expect(alternateRequests(m)).toHaveLength(2);
      const session = [...m.sessions.values()].find((s) => s.request.requireUnleased);
      if (!session) throw Error("Missing delayed refresh session");
      session.payload = {...session.payload, executionPayloadValue: 2_000_000_000_000_000_000n};
      await vi.advanceTimersByTimeAsync(350);
      expect(m.offer(alternate)?.message.value).toBe(1_800_000_000);
      expect(Date.now()).toBeLessThanOrEqual(11_600);
      expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    });

    it("clamps a large refresh lead until after primary gossip and its safety margin", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 5000, deadlineBps: 9250}, [9850, 10000, 10400, 10800]);
      const old = attributes(33, 44);
      m.start(old);
      await vi.advanceTimersByTimeAsync(100);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(old);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(alternateRequests(m)).toHaveLength(0);
      expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(99);
      expect(alternateRequests(m)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(alternateRequests(m)).toHaveLength(1);
    });

    it.each([500, 1000])("skips or defers a refresh with insufficient gossip headroom (%s ms)", async (lead) => {
      const m = setup({alternateRefreshBeforeSlotMs: lead, deadlineBps: 9250}, [9850, 10000, 10400, 10800]);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(attributes(3, 4));
      await vi.advanceTimersByTimeAsync(11_150);
      expect(alternateRequests(m)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(50);
      expect(alternateRequests(m)).toHaveLength(lead === 1000 ? 2 : 1);
      await vi.advanceTimersByTimeAsync(800);
      expect(alternateRequests(m)).toHaveLength(lead === 1000 ? 2 : 1);
    });

    it("lets a distinct branch pass a delayed refresh and caps total attempts", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 2000});
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(attributes(3, 4));
      await vi.advanceTimersByTimeAsync(600);
      for (let i = 10; i < 13; i++) m.bidder.onAlternatePayloadAttributes(attributes(i, i));
      await vi.advanceTimersByTimeAsync(1500);
      expect(alternateRequests(m)).toHaveLength(4);
      for (let i = 10; i < 13; i++) expect(m.offer(attributes(i, i))).not.toBeNull();
      await vi.advanceTimersByTimeAsync(9900);
      expect(alternateRequests(m)).toHaveLength(4);
    });

    it("starts a due distinct branch before a due retained refresh", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 2000, deadlineBps: 8500});
      const alternate = attributes(3, 4);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      m.canRetainAlternate.mockReturnValue(false);
      await vi.advanceTimersByTimeAsync(9750);
      m.bidder.onAlternatePayloadAttributes(attributes(8, 9));
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(50);
      expect(alternateRequests(m).map(([r]) => r.forkchoiceState.headBlockHash)).toEqual([
        toRootHex(alternate.data.parentBlockHash),
        toRootHex(attributes(8, 9).data.parentBlockHash),
      ]);
    });

    it.each(["lower value", "equal value"] as const)(
      "keeps the prior offer without persistence for %s",
      async (change) => {
        const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250});
        const alternate = attributes(3, 4);
        m.start(attributes(4, 5));
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(600);
        const previous = m.offer(alternate);
        const writes = m.retainCommitment.mock.calls.length;
        const revisions = m.ledger.getRevisionCount(1);
        await vi.advanceTimersByTimeAsync(10_650);
        const refreshed = [...m.sessions.values()].find((s) => s.request.requireUnleased);
        if (!refreshed) throw Error("Missing refresh session");
        if (change === "lower value") refreshed.payload = {...refreshed.payload, executionPayloadValue: 1n};
        await vi.advanceTimersByTimeAsync(350);
        expect(m.offer(alternate)).toBe(previous);
        expect(m.retainCommitment).toHaveBeenCalledTimes(writes);
        expect(m.ledger.getRevisionCount(1)).toBe(revisions);
      }
    );

    it.each(["revision", "payload"] as const)("does not start a refresh without %s capacity", async (kind) => {
      const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250, maxRevisionsPerSlot: 4});
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(attributes(3, 4));
      await vi.advanceTimersByTimeAsync(600);
      if (kind === "payload") {
        vi.spyOn(m.ledger, "getRevisionCount").mockReturnValue(1);
        vi.spyOn(m.payloadStore, "hasCapacityForAlternate").mockReturnValue(false);
      }
      await vi.advanceTimersByTimeAsync(11_000);
      expect(alternateRequests(m)).toHaveLength(1);
      expect(m.logger.debug.mock.calls.some(([, context]) => hasReason(context, "refresh_capacity"))).toBe(true);
    });

    it.each(["inactive", "dependent root", "missing builder"] as const)(
      "uses updated queued eligibility (%s)",
      async (change) => {
        const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250});
        const alternate = attributes(3, 4);
        m.start(attributes(4, 5));
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(600);
        const updated = structuredClone(alternate);
        if (change === "inactive") updated.context.builders[0].active = false;
        if (change === "dependent root") updated.context.dependentRoot = Buffer.alloc(32, 9);
        if (change === "missing builder") updated.context.builders = [];
        m.bidder.onAlternatePayloadAttributes(updated);
        await vi.advanceTimersByTimeAsync(11_000);
        expect(alternateRequests(m)).toHaveLength(1);
        expect(m.offer(alternate)?.message.value).toBe(900_000_000);
      }
    );

    it("rechecks fresh metadata delivered while the refresh is running", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250});
      const alternate = attributes(3, 4);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(11_250);
      const updated = structuredClone(alternate);
      updated.context.builders[0].active = false;
      m.bidder.onAlternatePayloadAttributes(updated);
      await vi.advanceTimersByTimeAsync(350);
      expect(alternateRequests(m)).toHaveLength(2);
      expect(m.offer(alternate)?.message.value).toBe(900_000_000);
      expect(m.retainCommitment).toHaveBeenCalledTimes(2);
    });

    it("preempts a refresh for a new primary without retrying it", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 2000, deadlineBps: 8500});
      const alternate = attributes(3, 4);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(10_400);
      expect(alternateRequests(m)).toHaveLength(2);
      m.start(attributes(8, 9));
      await vi.advanceTimersByTimeAsync(900);
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(900);
      expect(alternateRequests(m)).toHaveLength(2);
      expect(m.offer(attributes(8, 9))).not.toBeNull();
    });

    it("preserves updated branch collateral when an initial attempt is retried", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 750});
      const alternate = attributes(33, 44);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(200);
      const updated = structuredClone(alternate);
      updated.context.builders[0].availableGwei = 500_000_000;
      m.bidder.onAlternatePayloadAttributes(updated);
      m.start(attributes(4, 6));
      await vi.advanceTimersByTimeAsync(800);
      expect(alternateRequests(m)).toHaveLength(2);
      expect(m.offer(alternate)).toBeNull();
    });

    it("admits a distinct branch even when retained refreshes fill the queue", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 2000});
      const retained = Array.from({length: 4}, (_, i) => attributes(20 + i, 30 + i));
      for (const event of retained) {
        m.start(event);
        await vi.advanceTimersByTimeAsync(100);
      }
      m.start(attributes(40, 50));
      await vi.advanceTimersByTimeAsync(100);
      m.canRetainAlternate.mockReturnValue(false);
      for (const event of retained) m.bidder.onAlternatePayloadAttributes(event);
      const distinct = attributes(60, 70);
      m.bidder.onAlternatePayloadAttributes(distinct);
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(550);
      expect(alternateRequests(m)).toHaveLength(1);
      expect(alternateRequests(m)[0][0].forkchoiceState.headBlockHash).toBe(toRootHex(distinct.data.parentBlockHash));
      expect(m.offer(distinct)).not.toBeNull();
    });

    it("does not evict a refresh for an already attempted failed tuple", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 800, deadlineBps: 9250});
      const retained = Array.from({length: 4}, (_, i) => attributes(20 + i, 30 + i));
      for (const event of retained) {
        m.start(event);
        await vi.advanceTimersByTimeAsync(100);
      }
      m.start(attributes(40, 50));
      await vi.advanceTimersByTimeAsync(100);
      const failed = attributes(60, 70);
      failed.context.builders[0].active = false;
      m.bidder.onAlternatePayloadAttributes(failed);
      await vi.advanceTimersByTimeAsync(0);
      for (const event of retained) m.bidder.onAlternatePayloadAttributes(event);
      m.bidder.onAlternatePayloadAttributes(failed);
      await vi.advanceTimersByTimeAsync(10_700);
      expect(alternateRequests(m)).toHaveLength(1);
      expect(alternateRequests(m)[0][0].forkchoiceState.headBlockHash).toBe(
        toRootHex(retained[0].data.parentBlockHash)
      );
    });

    it("does not reuse a queued refresh when that tuple becomes primary again", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250});
      const alternate = attributes(33, 44);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      m.start(alternate);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(alternateRequests(m)).toHaveLength(1);
      expect(m.sessions.size).toBe(1);
    });

    it("waits for the superseded primary's cleanup even after its release times out", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250});
      const old = attributes(33, 44);
      const released = defer<void>();
      m.payloadSource.release.mockImplementation(async (handle) => {
        if (handle.payloadId === "1") await released.promise;
        m.sessions.delete(handle.payloadId);
      });
      m.start(old);
      await vi.advanceTimersByTimeAsync(2000);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(old);
      await vi.advanceTimersByTimeAsync(9250);
      expect(alternateRequests(m)).toHaveLength(0);
      expect(m.sessions.size).toBe(2);
      released.resolve();
      await vi.advanceTimersByTimeAsync(400);
      expect(alternateRequests(m)).toHaveLength(1);
      expect(m.sessions.size).toBe(1);
    });

    it.each(["preferences", "branch balance"] as const)("rechecks %s at refresh retention", async (change) => {
      const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250});
      const alternate = attributes(33, 44);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(11_250);
      const session = [...m.sessions.values()].find((s) => s.request.requireUnleased);
      if (!session) throw Error("Missing refresh session");
      session.payload = {...session.payload, executionPayloadValue: 2_000_000_000_000_000_000n};
      if (change === "preferences") m.proposerPreferencesTracker.prune(2);
      else {
        const updated = structuredClone(alternate);
        updated.context.builders[0].availableGwei = 1_000_000_000;
        m.bidder.onAlternatePayloadAttributes(updated);
      }
      await vi.advanceTimersByTimeAsync(350);
      expect(m.offer(alternate)?.message.value).toBe(900_000_000);
      expect(m.retainCommitment).toHaveBeenCalledTimes(2);
    });

    it.each([0, 800])(
      "keeps an alternate eligible after identical preferences are received again (%s)",
      async (lead) => {
        const m = setup({alternateRefreshBeforeSlotMs: lead});
        const alternate = attributes(33, 44);
        m.start(attributes(4, 5));
        m.bidder.onAlternatePayloadAttributes(alternate);
        await vi.advanceTimersByTimeAsync(200);
        const original = m.proposerPreferencesTracker.get(1, toRootHex(dependentRoot));
        if (!original) throw Error("Missing proposer preferences");
        expect(m.proposerPreferencesTracker.onProposerPreferences(structuredClone(original))).toBe(false);
        expect(m.proposerPreferencesTracker.get(1, toRootHex(dependentRoot))).toBe(original);
        await vi.advanceTimersByTimeAsync(400);
        expect(m.offer(alternate)?.message.value).toBe(900_000_000);
      }
    );

    it("retains a durable refresh for reveal only if branch eligibility changes during persistence", async () => {
      const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250});
      const alternate = attributes(33, 44);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(11_250);
      const session = [...m.sessions.values()].find((s) => s.request.requireUnleased);
      if (!session) throw Error("Missing refresh session");
      session.payload = {...session.payload, executionPayloadValue: 2_000_000_000_000_000_000n};
      const retained = defer<void>();
      m.retainCommitment.mockImplementation(() => retained.promise);
      await vi.advanceTimersByTimeAsync(350);
      const refreshed = m.retainCommitment.mock.calls.at(-1)?.[0];
      if (!refreshed) throw Error("Missing refresh commitment");
      const updated = structuredClone(alternate);
      updated.context.builders[0].active = false;
      m.bidder.onAlternatePayloadAttributes(updated);
      retained.resolve();
      await vi.advanceTimersByTimeAsync(20);
      expect(m.bidStore.has(refreshed)).toBe(true);
      expect(m.bidStore.canOffer(refreshed)).toBe(false);
      expect(m.payloadStore.has(toRootHex(refreshed.message.blockHash))).toBe(true);
      expect(m.offer(alternate)?.message.value).toBe(900_000_000);
      expect(alternateRequests(m)).toHaveLength(2);
    });

    it.each(["releasing", "uncertain"] as const)("waits for confirmed cleanup before refresh (%s)", async (kind) => {
      const m = setup({alternateRefreshBeforeSlotMs: 750, deadlineBps: 9250});
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(attributes(3, 4));
      await vi.advanceTimersByTimeAsync(600);
      m.payloadSource.getResources.mockReturnValue({
        capacity: 2,
        active: 1,
        preparing: 0,
        releasing: 0,
        uncertain: 0,
        alternatesDisabled: false,
        [kind]: 1,
      });
      await vi.advanceTimersByTimeAsync(11_000);
      expect(alternateRequests(m)).toHaveLength(1);
    });
  });

  describe("bounded journal recheck", () => {
    function startBusyAlternate(options: Partial<BidderOptions> = {}) {
      const m = setup(options);
      const primary = attributes(4, 5);
      const alternate = attributes(4, 6);
      m.payloadSource.getPayload.mockImplementation(async (handle) => {
        const session = m.sessions.get(handle.payloadId);
        if (!session) throw Error("Missing session");
        if (session.request.requireUnleased) m.canRetainAlternate.mockReturnValue(false);
        return session.payload;
      });
      m.start(primary);
      m.bidder.onAlternatePayloadAttributes(alternate);
      return {...m, primary, alternate};
    }

    function retainedAlternates(m: ReturnType<typeof startBusyAlternate>) {
      return m.retainCommitment.mock.calls.filter(
        ([bid]) => toRootHex(bid.message.parentBlockHash) === toRootHex(m.alternate.data.parentBlockHash)
      );
    }

    it("uses the copied snapshot after one idle recheck without another build or retrieval", async () => {
      const m = startBusyAlternate();
      await vi.advanceTimersByTimeAsync(350);
      expect(m.sessions.size).toBe(2);
      expect(m.offer(m.alternate)).toBeNull();
      const primary = m.sessions.get("1");
      if (!primary) throw Error("Missing primary");
      primary.payload = {
        ...primary.payload,
        executionPayloadValue: 2_000_000_000_000_000_000n,
        executionPayload: {...primary.payload.executionPayload, blockHash: Buffer.alloc(32, 19)},
      };
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(9);
      expect(m.offer(m.alternate)).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(m.offer(m.alternate)).not.toBeNull();
      expect(retainedAlternates(m)).toHaveLength(1);
      expect(m.payloadSource.prepare.mock.calls.filter(([r]) => r.requireUnleased)).toHaveLength(1);
      expect(m.payloadSource.getPayload.mock.calls.filter(([h]) => h.payloadId === "2")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(40);
      expect(m.offer(m.primary)?.message.value).toBe(1_800_000_000);
      expect(m.sessions.size).toBe(1);
      expect(m.logger.debug).toHaveBeenCalledWith(
        "Alternate parent journal recheck",
        expect.objectContaining({code: "BUILDER_ALTERNATE_JOURNAL_RECHECK", outcome: "idle"})
      );
    });

    it("skips after one recheck if the journal remains busy and never restarts that build", async () => {
      const m = startBusyAlternate();
      await vi.advanceTimersByTimeAsync(360);
      expect(m.offer(m.alternate)).toBeNull();
      expect(retainedAlternates(m)).toHaveLength(0);
      expect(m.sessions.size).toBe(1);
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(600);
      expect(m.payloadSource.prepare.mock.calls.filter(([r]) => r.requireUnleased)).toHaveLength(1);
      expect(m.logger.debug).toHaveBeenCalledWith(
        "Alternate parent journal recheck",
        expect.objectContaining({outcome: "busy"})
      );
    });

    it.each([100, 99])("requires at least 100ms remaining after the wait (%ims)", async (remainingMs) => {
      const m = startBusyAlternate();
      await vi.advanceTimersByTimeAsync(350);
      m.canRetainAlternate.mockReturnValue(true);
      vi.setSystemTime(500 - remainingMs - 10);
      await vi.advanceTimersByTimeAsync(10);
      expect(retainedAlternates(m)).toHaveLength(remainingMs === 100 ? 1 : 0);
      expect(m.logger.debug).toHaveBeenCalledWith(
        "Alternate parent journal recheck",
        expect.objectContaining({outcome: remainingMs === 100 ? "idle" : "headroom", remainingMs})
      );
    });

    it("rejects the alternate if the same primary becomes unready while waiting", async () => {
      const m = startBusyAlternate({updateIntervalMs: 27});
      await vi.advanceTimersByTimeAsync(350);
      const primary = m.sessions.get("1");
      if (!primary) throw Error("Missing primary");
      primary.payload = {
        ...primary.payload,
        offerEligibility: {
          generation: "0x0",
          lease: {generation: "0x0", ready: false, validUntil: 0, validUntilUnixMs: 0},
        },
      };
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(10);
      expect(retainedAlternates(m)).toHaveLength(0);
      expect(m.offer(m.alternate)).toBeNull();
      expect(m.logger.debug).toHaveBeenCalledWith(
        "Alternate parent journal recheck",
        expect.objectContaining({outcome: "primary_not_ready"})
      );
    });

    it("does not let a recheck diagnostic failure change admission", async () => {
      const m = startBusyAlternate();
      m.logger.debug.mockImplementation((message) => {
        if (message === "Alternate parent journal recheck") throw Error("logger unavailable");
      });
      await vi.advanceTimersByTimeAsync(350);
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(10);
      expect(retainedAlternates(m)).toHaveLength(1);
      expect(m.offer(m.alternate)).not.toBeNull();
    });

    it.each(["alternatesDisabled", "uncertain"] as const)("rechecks source %s after waiting", async (field) => {
      const m = startBusyAlternate();
      await vi.advanceTimersByTimeAsync(350);
      const resources = m.payloadSource.getResources();
      if (!resources) throw Error("Missing resources");
      m.payloadSource.getResources.mockReturnValue({...resources, [field]: field === "uncertain" ? 1 : true});
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(10);
      expect(retainedAlternates(m)).toHaveLength(0);
      expect(m.offer(m.alternate)).toBeNull();
      expect(m.logger.debug).toHaveBeenCalledWith(
        "Alternate parent journal recheck",
        expect.objectContaining({outcome: field === "uncertain" ? "source_uncertain" : "source_disabled"})
      );
    });

    it("does not rebuild a copied recheck snapshot after an eligible primary replaces it", async () => {
      const m = startBusyAlternate();
      await vi.advanceTimersByTimeAsync(350);
      m.canRetainAlternate.mockReturnValue(true);
      const replacement = attributes(8, 9);
      m.start(replacement);
      await vi.advanceTimersByTimeAsync(1000);
      expect(m.offer(replacement)).not.toBeNull();
      expect(m.offer(m.alternate)).toBeNull();
      expect(retainedAlternates(m)).toHaveLength(0);
      expect(m.payloadSource.prepare.mock.calls.filter(([r]) => r.requireUnleased)).toHaveLength(1);
      expect(m.payloadSource.getPayload.mock.calls.filter(([h]) => h.payloadId === "2")).toHaveLength(1);
      expect(m.sessions.size).toBe(1);
    });

    it.each([15, 16])("preserves the 250ms deadline with %ims retrieval before a busy recheck", async (retrievalMs) => {
      const m = startBusyAlternate({alternateBuildDurationMs: 250});
      const getPayload = m.payloadSource.getPayload.getMockImplementation();
      if (!getPayload) throw Error("Missing payload implementation");
      m.payloadSource.getPayload.mockImplementation(async (...args) => {
        const payload = await getPayload(...args);
        if (args[0].payloadId === "2") await new Promise<void>((resolve) => setTimeout(resolve, retrievalMs));
        return payload;
      });
      await vi.advanceTimersByTimeAsync(125 + retrievalMs);
      m.canRetainAlternate.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(10);
      expect(retainedAlternates(m)).toHaveLength(retrievalMs === 15 ? 1 : 0);
      expect(m.payloadSource.getPayload.mock.calls.filter(([h]) => h.payloadId === "2")).toHaveLength(1);
      expect(m.logger.debug).toHaveBeenCalledWith(
        "Alternate parent journal recheck",
        expect.objectContaining({outcome: retrievalMs === 15 ? "idle" : "headroom"})
      );
    });

    it.each(["abort", "primary change", "deadline", "insufficient headroom"] as const)(
      "does not sign when %s occurs during the recheck wait",
      async (reason) => {
        const m = startBusyAlternate();
        await vi.advanceTimersByTimeAsync(350);
        m.canRetainAlternate.mockReturnValue(true);
        if (reason === "abort") controller.abort();
        else if (reason === "primary change") {
          const replacement = attributes(8, 9);
          replacement.data.proposerIndex = 4;
          m.start(replacement);
        } else vi.setSystemTime(reason === "deadline" ? 600 : 405);
        await vi.advanceTimersByTimeAsync(10);
        expect(m.offer(m.alternate)).toBeNull();
        expect(retainedAlternates(m)).toHaveLength(0);
        expect(m.payloadSource.prepare.mock.calls.filter(([r]) => r.requireUnleased)).toHaveLength(1);
        expect(m.logger.debug).toHaveBeenCalledWith(
          "Alternate parent journal recheck",
          expect.objectContaining({outcome: reason === "abort" || reason === "primary change" ? "aborted" : "headroom"})
        );
      }
    );

    it.each(["branch capacity", "head balance", "new liability"] as const)(
      "uses fresh %s after the recheck wait",
      async (change) => {
        const m = startBusyAlternate();
        if (change === "new liability") m.alternate.context.builders[0].availableGwei = 1_000_000_000;
        await vi.advanceTimersByTimeAsync(350);
        m.canRetainAlternate.mockReturnValue(true);
        if (change === "branch capacity") m.alternate.context.builders[0].availableGwei = 400_000_000;
        else if (change === "head balance")
          m.getBuilderStatus.mockReturnValue({status: "active", balance: 1_300_000_000});
        else {
          const recorded = m.ledger.getBidsForSlot(1)[0];
          expect(m.ledger.recordWin(recorded, toRootHex(Buffer.alloc(32, 88)))).not.toBeNull();
        }
        await vi.advanceTimersByTimeAsync(10);
        expect(m.offer(m.alternate)).toBeNull();
        expect(retainedAlternates(m)).toHaveLength(0);
        expect(m.logger.info).toHaveBeenCalledWith(
          "Bid policy declined to bid",
          expect.objectContaining({
            parentBlockHash: toRootHex(m.alternate.data.parentBlockHash),
            coverableGwei:
              change === "branch capacity" ? 400_000_000 : change === "head balance" ? 300_000_000 : 100_000_000,
          })
        );
      }
    );

    it("rejects an inactive branch changed while waiting before it signs", async () => {
      const m = startBusyAlternate();
      await vi.advanceTimersByTimeAsync(350);
      m.canRetainAlternate.mockReturnValue(true);
      m.alternate.context.builders[0].active = false;
      await vi.advanceTimersByTimeAsync(10);
      expect(retainedAlternates(m)).toHaveLength(0);
      expect(m.offer(m.alternate)).toBeNull();
    });

    it("checks revision capacity after waiting instead of reserving ahead of primary updates", async () => {
      const m = startBusyAlternate({maxRevisionsPerSlot: 4});
      await vi.advanceTimersByTimeAsync(350);
      m.canRetainAlternate.mockReturnValue(true);
      const recorded = m.ledger.getBidsForSlot(1)[0];
      m.ledger.recordRevision({
        ...recorded,
        blockHash: toRootHex(Buffer.alloc(32, 87)),
        signedBidRoot: toRootHex(Buffer.alloc(32, 86)),
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(m.ledger.getRevisionCount(1)).toBe(2);
      expect(retainedAlternates(m)).toHaveLength(0);
      expect(m.offer(m.alternate)).toBeNull();
    });
  });

  it("retains four head/parent FULL/EMPTY tuples while the primary keeps improving and alone gossips", async () => {
    const m = setup();
    const contexts = [attributes(4, 5), attributes(4, 6), attributes(3, 6), attributes(3, 7)];
    m.start(contexts[0]);
    for (const context of contexts.slice(1)) m.bidder.onAlternatePayloadAttributes(context);
    await vi.advanceTimersByTimeAsync(1500);
    for (const context of contexts) expect(m.offer(context), toRootHex(context.data.parentBlockRoot)).not.toBeNull();
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(4);
    expect(m.sessions.size).toBe(1);
    expect(m.payloadSource.release.mock.calls.map(([handle]) => handle.payloadId)).not.toContain("1");
    expect(m.ledger.getRevisionCount(1)).toBe(4);
    expect(m.api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    for (const context of contexts.slice(1)) m.bidder.onAlternatePayloadAttributes(context);
    const primary = m.sessions.get("1");
    if (!primary) throw Error("Missing primary");
    primary.payload = {
      ...primary.payload,
      executionPayloadValue: 2_000_000_000_000_000_000n,
      executionPayload: {...primary.payload.executionPayload, blockHash: Buffer.alloc(32, 19)},
    };
    await vi.advanceTimersByTimeAsync(8700);
    expect(m.offer(contexts[0])?.message.value).toBe(1_800_000_000);
    expect(m.api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    const bid = m.api.beacon.publishExecutionPayloadBid.mock.calls[0][0].signedExecutionPayloadBid;
    expect(bid.message.parentBlockRoot).toEqual(contexts[0].data.parentBlockRoot);
    for (const context of contexts) {
      const offered = m.offer(context);
      if (!offered) throw Error("Missing retained branch");
      expect(m.payloadStore.has(toRootHex(offered.message.blockHash))).toBe(true);
    }
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(4);
  });

  it.each([250, 500, 1000])(
    "finishes a 100ms alternate journal write within the existing %ims budget",
    async (duration) => {
      const m = setup({alternateBuildDurationMs: duration});
      const primary = attributes(4, 5);
      const alternate = attributes(4, 6);
      let retainedAt: number | undefined;
      m.retainCommitment.mockImplementation(async (bid) => {
        if (toRootHex(bid.message.parentBlockHash) === toRootHex(alternate.data.parentBlockHash)) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          retainedAt = Date.now();
        }
      });
      m.start(primary);
      const startedAt = Date.now();
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(duration);

      expect(retainedAt).toBeDefined();
      expect(retainedAt).toBeLessThan(startedAt + duration);
      expect(m.offer(alternate)).not.toBeNull();
      expect(m.offer(primary)).not.toBeNull();
      expect(m.sessions.size).toBe(1);
      expect(m.payloadSource.release.mock.calls.map(([handle]) => handle.payloadId)).not.toContain("1");
    }
  );

  it.each([20, 30])(
    "includes %ims of retrieval in the shortest alternate retention deadline",
    async (retrievalTime) => {
      const m = setup({alternateBuildDurationMs: 250});
      const alternate = attributes(4, 6);
      const retained: gloas.SignedExecutionPayloadBid[] = [];
      m.payloadSource.getPayload.mockImplementation(async (handle) => {
        if (handle.payloadId === "2") await new Promise<void>((resolve) => setTimeout(resolve, retrievalTime));
        const session = m.sessions.get(handle.payloadId);
        if (!session) throw Error("Missing session");
        return session.payload;
      });
      m.retainCommitment.mockImplementation(async (bid) => {
        if (toRootHex(bid.message.parentBlockHash) === toRootHex(alternate.data.parentBlockHash)) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          retained.push(bid);
        }
      });
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(300);

      expect(retained).toHaveLength(1);
      expect(m.bidStore.has(retained[0])).toBe(true);
      expect(m.payloadStore.has(toRootHex(retained[0].message.blockHash))).toBe(true);
      expect(m.bidStore.canOffer(retained[0])).toBe(retrievalTime === 20);
      expect(m.offer(alternate) !== null).toBe(retrievalTime === 20);
      if (retrievalTime === 30)
        expect(m.logger.debug).toHaveBeenCalledWith("Skipping alternate parent bid", {
          slot: 1,
          parentBlockRoot: toRootHex(alternate.data.parentBlockRoot),
          parentBlockHash: toRootHex(alternate.data.parentBlockHash),
          reason: "deadline_after_retention",
        });
    }
  );

  it.each([false, true])(
    "keeps the primary alive across standard-topic alternate/repeated-primary interleaving (enabled=%s)",
    async (alternateBranches) => {
      const m = setup({alternateBranches});
      const primary = attributes(4, 5);
      const alternate = attributes(4, 6);
      m.start(primary);
      await vi.advanceTimersByTimeAsync(100);
      const primarySession = m.sessions.get("1");
      expect(primarySession).toBeDefined();
      for (let i = 0; i < 3; i++) {
        await m.bidder.onPayloadAttributes(alternate);
        m.start(primary);
        await vi.advanceTimersByTimeAsync(200);
      }
      expect(m.sessions.get("1")).toBe(primarySession);
      expect(m.payloadSource.release.mock.calls.map(([handle]) => handle.payloadId)).not.toContain("1");
      expect(m.payloadSource.prepare).toHaveBeenCalledTimes(alternateBranches ? 2 : 1);
      expect(m.offer(primary)).not.toBeNull();
      expect(m.offer(alternate) !== null).toBe(alternateBranches);
      expect(m.logger.error).not.toHaveBeenCalled();
    }
  );

  it("waits for an unleased primary snapshot before allocating an alternate", async () => {
    const m = setup();
    const ready = defer<BuiltPayload>();
    m.payloadSource.getPayload.mockImplementationOnce(() => ready.promise);
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(200);
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(1);
    const primary = m.sessions.get("1");
    if (!primary) throw Error("Missing primary");
    ready.resolve(primary.payload);
    await vi.advanceTimersByTimeAsync(500);
    expect(m.offer(attributes(4, 6))).not.toBeNull();
  });

  it("does not use leased primary snapshots to enable alternates", async () => {
    const m = setup();
    m.payloadSource.getPayload.mockImplementation(async (handle) => {
      const session = m.sessions.get(handle.payloadId);
      if (!session) throw Error("Missing session");
      const {payload} = session;
      return {
        ...payload,
        offerEligibility: {
          generation: "0x0",
          lease: {
            generation: "0x0",
            ready: true,
            validUntil: performance.now() + 1000,
            validUntilUnixMs: Date.now() + 1000,
          },
        },
      };
    });
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(1);
  });

  it.each(["preparing", "releasing", "uncertain"] as const)("does not allocate over a %s reservation", async (kind) => {
    const m = setup();
    m.payloadSource.getResources.mockReturnValue({
      capacity: 2,
      active: 1,
      preparing: 0,
      releasing: 0,
      uncertain: 0,
      alternatesDisabled: false,
      [kind]: 1,
    } as PayloadSourceResources);
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(1);
  });

  it("logs source blocking reasons once per slot despite repeated resource polls", async () => {
    const m = setup();
    const resources: PayloadSourceResources = {
      capacity: 2,
      active: 1,
      preparing: 0,
      releasing: 0,
      uncertain: 1,
      alternatesDisabled: false,
    };
    Object.assign(resources, {code: "private-code", reason: "private-reason", endpoint: "http://private:secret@rpc"});
    m.payloadSource.getResources.mockReturnValue(resources);
    const alternate = attributes(4, 6);
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(alternate);
    await vi.advanceTimersByTimeAsync(2000);
    const diagnostics = () => m.logger.debug.mock.calls.filter(([message]) => message === "Alternate parent admission");
    expect(m.payloadSource.getResources.mock.calls.length).toBeGreaterThan(30);
    expect(diagnostics().filter(([, context]) => hasReason(context, "source_busy"))).toHaveLength(1);
    expect(m.logger.debug).toHaveBeenCalledWith("Alternate parent admission", {
      code: "BUILDER_ALTERNATE_ADMISSION",
      reason: "source_busy",
      localSlot: 0,
      slot: 1,
      parentBlockRoot: toRootHex(alternate.data.parentBlockRoot),
      parentBlockHash: toRootHex(alternate.data.parentBlockHash),
      primarySlot: 1,
      primaryReady: true,
      activeBuilds: 1,
      queueSize: 1,
      attempts: 0,
      capacity: 2,
      active: 1,
      preparing: 0,
      releasing: 0,
      uncertain: 1,
      alternatesDisabled: false,
    });
    resources.alternatesDisabled = true;
    await vi.advanceTimersByTimeAsync(2000);
    for (let i = 0; i < 100; i++) m.bidder.onAlternatePayloadAttributes(alternate);
    expect(diagnostics().filter(([, context]) => hasReason(context, "source_disabled"))).toHaveLength(1);
    expect(diagnostics().filter(([, context]) => hasReason(context, "received"))).toHaveLength(1);
    expect(diagnostics().length).toBeLessThanOrEqual(16);
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(1);
    expect(m.offer(alternate)).toBeNull();
    expect(m.offer(attributes(4, 5))).not.toBeNull();
  });

  it("bounds receipt diagnostics by local slot regardless of event slot or tuple churn", () => {
    const m = setup();
    const flood = () => {
      for (let i = 0; i < 200; i++) {
        const event = attributes(i, 6);
        event.data.proposalSlot = 1000 + i;
        m.bidder.onAlternatePayloadAttributes(event);
      }
    };
    const diagnostics = () => m.logger.debug.mock.calls.filter(([message]) => message === "Alternate parent admission");
    flood();
    expect(diagnostics().filter(([, context]) => hasReason(context, "received"))).toHaveLength(4);
    expect(diagnostics().filter(([, context]) => hasReason(context, "primary_context_unavailable"))).toHaveLength(1);
    expect(diagnostics().length).toBeLessThanOrEqual(16);
    vi.setSystemTime(12_000);
    flood();
    expect(diagnostics().filter(([, context]) => hasReason(context, "received"))).toHaveLength(8);
    expect(diagnostics().length).toBeLessThanOrEqual(32);
    const count = diagnostics().length;
    vi.setSystemTime(0);
    flood();
    expect(diagnostics()).toHaveLength(count);
    expect(m.payloadSource.prepare).not.toHaveBeenCalled();
  });

  it("does not alter primary or alternate construction when admission diagnostics throw", async () => {
    const m = setup();
    m.logger.debug.mockImplementation((message) => {
      if (message === "Alternate parent admission") throw new Error("logger unavailable");
    });
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(2);
    expect(m.sessions.size).toBe(1);
    expect(m.offer(attributes(4, 5))).not.toBeNull();
    expect(m.offer(attributes(4, 6))).not.toBeNull();
  });

  it("does not expose a diagnostic clock failure when no primary exists", () => {
    const m = setup();
    vi.spyOn(m.clock, "getCurrentSlot").mockImplementation(() => {
      throw new Error("clock unavailable");
    });
    expect(() => m.bidder.onAlternatePayloadAttributes(attributes(4, 6))).not.toThrow();
    expect(m.payloadSource.prepare).not.toHaveBeenCalled();
  });

  it("waits around gossip and does not allocate new work too late to finish before the slot", async () => {
    const m = setup();
    m.start(attributes(4, 5));
    await vi.advanceTimersByTimeAsync(10_000);
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1600);
    expect(m.offer(attributes(4, 6))).not.toBeNull();
    m.bidder.onAlternatePayloadAttributes(attributes(3, 7));
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(2);
  });

  it("prioritizes the new primary and retries its unpublished alternate only after confirmed cleanup", async () => {
    const m = setup();
    const old = attributes(4, 5);
    const ended = defer<void>();
    m.payloadSource.release.mockImplementation(async (handle) => {
      if (handle.payloadId === "2") await ended.promise;
      m.sessions.delete(handle.payloadId);
    });
    m.start(old);
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(100);
    const alternate = m.sessions.get("2");
    expect(alternate).toBeDefined();
    m.start(attributes(8, 9));
    await vi.advanceTimersByTimeAsync(100);
    expect(m.payloadSource.release.mock.calls.map(([handle]) => handle.payloadId)).toContain("2");
    expect(m.offer(attributes(4, 6))).toBeNull();
    expect(m.offer(attributes(8, 9))).not.toBeNull();
    expect(m.offer(old)).not.toBeNull();
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(3);
    expect(m.sessions.size).toBe(2);
    ended.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(m.offer(attributes(4, 6))).not.toBeNull();
    expect(m.payloadSource.prepare.mock.calls.map(([request]) => request.requireUnleased === true)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(m.sessions.size).toBe(1);
  });

  it("allows at most one preemption retry per tuple across repeated primary switches", async () => {
    const m = setup();
    const alternate = attributes(4, 6);
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(alternate);
    await vi.advanceTimersByTimeAsync(100);
    m.start(attributes(8, 9));
    await vi.advanceTimersByTimeAsync(100);
    expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(2);
    m.start(attributes(10, 11));
    await vi.advanceTimersByTimeAsync(600);
    m.bidder.onAlternatePayloadAttributes(alternate);
    await vi.advanceTimersByTimeAsync(600);
    expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(2);
    expect(m.offer(alternate)).toBeNull();
    expect(m.offer(attributes(10, 11))).not.toBeNull();
    expect(m.sessions.size).toBe(1);
  });

  it.each(["slot", "proposer", "dependent root"] as const)(
    "does not retry a preempted alternate when the new primary changes %s",
    async (changed) => {
      const m = setup();
      const alternate = attributes(4, 6);
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(100);
      const next = attributes(8, 9);
      const root = changed === "dependent root" ? Buffer.alloc(32, 8) : dependentRoot;
      if (changed === "slot") {
        next.data.proposalSlot = 2;
        next.data.payloadAttributes.slotNumber = 2;
        next.data.payloadAttributes.timestamp = 24;
      }
      if (changed === "proposer") next.data.proposerIndex = 4;
      m.api.validator.getProposerDutiesV2.mockResolvedValue(
        mockApiResponse({
          data: [{slot: next.data.proposalSlot, validatorIndex: next.data.proposerIndex, pubkey: Buffer.alloc(48, 3)}],
          meta: {executionOptimistic: false, dependentRoot: toRootHex(root)},
        })
      );
      const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
      preferences.message.proposalSlot = next.data.proposalSlot;
      preferences.message.dependentRoot = root;
      preferences.message.targetGasLimit = 60_000_000n;
      m.proposerPreferencesTracker.onProposerPreferences(preferences);
      m.start(next);
      await vi.advanceTimersByTimeAsync(700);
      expect(m.offer(next)).not.toBeNull();
      expect(m.offer(alternate)).toBeNull();
      expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(1);
    }
  );

  it.each(["shutdown", "slot expired"] as const)(
    "does not retry after %s while preempted cleanup is pending",
    async (reason) => {
      const m = setup();
      const ended = defer<void>();
      m.payloadSource.release.mockImplementation(async (handle) => {
        if (handle.payloadId === "2") await ended.promise;
        m.sessions.delete(handle.payloadId);
      });
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
      await vi.advanceTimersByTimeAsync(100);
      m.start(attributes(8, 9));
      await vi.advanceTimersByTimeAsync(100);
      if (reason === "shutdown") controller.abort();
      else vi.setSystemTime(12_000);
      ended.resolve();
      await vi.advanceTimersByTimeAsync(100);
      expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(1);
      expect(m.offer(attributes(4, 6))).toBeNull();
    }
  );

  it("does not turn a normal alternate deadline failure into a primary-preemption retry", async () => {
    const m = setup();
    const blocked = defer<BuiltPayload>();
    m.payloadSource.getPayload.mockImplementation(async (handle) => {
      if (handle.payloadId === "2") return blocked.promise;
      const session = m.sessions.get(handle.payloadId);
      if (!session) throw Error("Missing session");
      return session.payload;
    });
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(550);
    m.start(attributes(8, 9));
    await vi.advanceTimersByTimeAsync(600);
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(100);
    expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(1);
    expect(m.offer(attributes(4, 6))).toBeNull();
    expect(m.offer(attributes(8, 9))).not.toBeNull();
    expect(m.logger.debug).toHaveBeenCalledWith("Skipping alternate parent bid", {
      slot: 1,
      parentBlockRoot: toRootHex(attributes(4, 6).data.parentBlockRoot),
      parentBlockHash: toRootHex(attributes(4, 6).data.parentBlockHash),
      reason: "deadline_before_retention",
    });
  });

  it("keeps a preemption retry queued while alternate cleanup remains uncertain", async () => {
    const m = setup();
    let uncertain = 0;
    m.payloadSource.getResources.mockImplementation(() => ({
      capacity: 2,
      active: m.sessions.size,
      preparing: 0,
      releasing: 0,
      uncertain,
      alternatesDisabled: false,
    }));
    m.payloadSource.release.mockImplementation(async (handle) => {
      m.sessions.delete(handle.payloadId);
      if (handle.payloadId === "2") {
        uncertain = 1;
        throw Error("UncertainEnd");
      }
    });
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(100);
    m.start(attributes(8, 9));
    await vi.advanceTimersByTimeAsync(600);
    expect(m.offer(attributes(8, 9))).not.toBeNull();
    expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(1);
    expect(m.offer(attributes(4, 6))).toBeNull();
    uncertain = 0;
    await vi.advanceTimersByTimeAsync(550);
    expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(2);
    expect(m.offer(attributes(4, 6))).not.toBeNull();
  });

  it("does not retry a failed retrieval when a primary switch arrives during cleanup", async () => {
    const m = setup();
    const ended = defer<void>();
    m.payloadSource.release.mockImplementation(async (handle) => {
      if (handle.payloadId === "2") await ended.promise;
      m.sessions.delete(handle.payloadId);
    });
    m.payloadSource.getPayload.mockImplementation(async (handle) => {
      if (handle.payloadId === "2") throw Error("WorkerRejected");
      const session = m.sessions.get(handle.payloadId);
      if (!session) throw Error("Missing session");
      return session.payload;
    });
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(460);
    m.start(attributes(8, 9));
    await vi.advanceTimersByTimeAsync(10);
    ended.resolve();
    await vi.advanceTimersByTimeAsync(600);
    expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(1);
    expect(m.offer(attributes(4, 6))).toBeNull();
  });

  it("counts a retry against the four actual alternate attempts per slot", async () => {
    const m = setup();
    const alternate = attributes(4, 6);
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(alternate);
    await vi.advanceTimersByTimeAsync(100);
    m.start(attributes(8, 9));
    await vi.advanceTimersByTimeAsync(600);
    expect(m.offer(alternate)).not.toBeNull();
    for (let i = 10; i < 13; i++) m.bidder.onAlternatePayloadAttributes(attributes(i, i));
    await vi.advanceTimersByTimeAsync(1600);
    expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(4);
    expect(m.offer(attributes(10, 10))).not.toBeNull();
    expect(m.offer(attributes(11, 11))).not.toBeNull();
    expect(m.offer(attributes(12, 12))).toBeNull();
  });

  it("does not retry a tuple retained while it becomes the primary", async () => {
    const m = setup();
    const alternate = attributes(4, 6);
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(alternate);
    await vi.advanceTimersByTimeAsync(100);
    m.start(alternate);
    await vi.advanceTimersByTimeAsync(600);
    const retained = m.offer(alternate);
    expect(retained).not.toBeNull();
    m.start(attributes(8, 9));
    m.bidder.onAlternatePayloadAttributes(alternate);
    await vi.advanceTimersByTimeAsync(600);
    expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(1);
    expect(m.offer(alternate)).toBe(retained);
    expect(m.logger.debug).not.toHaveBeenCalledWith("Retrying preempted alternate parent bid", expect.anything());
  });

  it("declines bids above branch-specific collateral and omits unknown identities", async () => {
    const m = setup();
    m.start(attributes(4, 5));
    const alternate = attributes(4, 6);
    alternate.context.builders[0].availableGwei = 100_000_000;
    m.bidder.onAlternatePayloadAttributes(alternate);
    const unknown = attributes(3, 7);
    unknown.context.builders[0].pubkey = Buffer.alloc(48, 2);
    m.bidder.onAlternatePayloadAttributes(unknown);
    await vi.advanceTimersByTimeAsync(1100);
    expect(m.offer(alternate)).toBeNull();
    expect(m.offer(unknown)).toBeNull();
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(2);
  });

  it("reserves half the revision budget for primary updates", async () => {
    const m = setup({maxRevisionsPerSlot: 4});
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    m.bidder.onAlternatePayloadAttributes(attributes(3, 7));
    await vi.advanceTimersByTimeAsync(1100);
    expect(m.offer(attributes(4, 6))).not.toBeNull();
    expect(m.offer(attributes(3, 7))).toBeNull();
    const primary = m.sessions.get("1");
    if (!primary) throw Error("Missing primary");
    primary.payload = {
      ...primary.payload,
      executionPayloadValue: 2_000_000_000_000_000_000n,
      executionPayload: {...primary.payload.executionPayload, blockHash: Buffer.alloc(32, 20)},
    };
    await vi.advanceTimersByTimeAsync(100);
    expect(m.offer(attributes(4, 5))?.message.value).toBe(1_800_000_000);
    expect(m.ledger.getRevisionCount(1)).toBe(3);
  });

  it.each(["timeout", "new primary", "wall deadline"])(
    "retains a late durable alternate for reveal without offering after %s",
    async (reason) => {
      const m = setup();
      const disk = defer<void>();
      const alternate = attributes(4, 6);
      const retained: gloas.SignedExecutionPayloadBid[] = [];
      m.retainCommitment.mockImplementation(async (bid) => {
        if (toRootHex(bid.message.parentBlockHash) === toRootHex(alternate.data.parentBlockHash)) {
          retained.push(bid);
          await disk.promise;
        }
      });
      const observed: unknown[] = [];
      m.bidStore.subscribe(
        1,
        toRootHex(alternate.data.parentBlockHash),
        toRootHex(alternate.data.parentBlockRoot),
        () => {
          const bid = m.offer(alternate);
          if (bid) observed.push(bid);
        }
      );
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(450);
      expect(retained).toHaveLength(1);
      if (reason === "timeout") await vi.advanceTimersByTimeAsync(100);
      else if (reason === "new primary") {
        m.start(attributes(8, 9));
        await vi.advanceTimersByTimeAsync(0);
      } else vi.setSystemTime(600);
      disk.resolve();
      await vi.advanceTimersByTimeAsync(100);
      expect(m.bidStore.has(retained[0])).toBe(true);
      expect(m.payloadStore.has(toRootHex(retained[0].message.blockHash))).toBe(true);
      expect(m.bidStore.canOffer(retained[0])).toBe(false);
      expect(m.offer(alternate)).toBeNull();
      expect(observed).toEqual([]);
      await vi.advanceTimersByTimeAsync(600);
      expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(1);
      expect(m.logger.debug).toHaveBeenCalledWith("Skipping alternate parent bid", {
        slot: 1,
        parentBlockRoot: toRootHex(alternate.data.parentBlockRoot),
        parentBlockHash: toRootHex(alternate.data.parentBlockHash),
        reason: reason === "new primary" ? "aborted_after_retention" : "deadline_after_retention",
      });
    }
  );

  it.each(["journal busy", "wall deadline"] as const)(
    "diagnoses an alternate skipped before persistence because of %s without retrying it",
    async (reason) => {
      const m = setup();
      const alternate = attributes(4, 6);
      m.payloadSource.getPayload.mockImplementation(async (handle) => {
        const session = m.sessions.get(handle.payloadId);
        if (!session) throw Error("Missing session");
        if (handle.payloadId === "2") {
          if (reason === "journal busy") m.canRetainAlternate.mockReturnValue(false);
          else vi.setSystemTime(600);
        }
        return session.payload;
      });
      m.start(attributes(4, 5));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(500);
      expect(m.offer(alternate)).toBeNull();
      expect(m.logger.debug).toHaveBeenCalledWith("Skipping alternate parent bid", {
        slot: 1,
        parentBlockRoot: toRootHex(alternate.data.parentBlockRoot),
        parentBlockHash: toRootHex(alternate.data.parentBlockHash),
        reason: reason === "journal busy" ? "journal_busy" : "deadline_before_retention",
      });
      m.canRetainAlternate.mockReturnValue(true);
      m.start(attributes(8, 9));
      m.bidder.onAlternatePayloadAttributes(alternate);
      await vi.advanceTimersByTimeAsync(600);
      expect(m.payloadSource.prepare.mock.calls.filter(([request]) => request.requireUnleased)).toHaveLength(1);
    }
  );

  it("refuses a primary whose proposer changed while duties were fetched", async () => {
    const m = setup();
    m.api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({
        data: [{slot: 1, validatorIndex: 4, pubkey: Buffer.alloc(48, 4)}],
        meta: {executionOptimistic: false, dependentRoot: toRootHex(dependentRoot)},
      })
    );
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.payloadSource.prepare).not.toHaveBeenCalled();
  });

  it("waits for confirmed alternate cleanup before starting the next snapshot", async () => {
    const m = setup();
    const ended = defer<void>();
    m.payloadSource.release.mockImplementation(async (handle) => {
      if (handle.payloadId === "2") await ended.promise;
      m.sessions.delete(handle.payloadId);
    });
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    m.bidder.onAlternatePayloadAttributes(attributes(3, 7));
    await vi.advanceTimersByTimeAsync(750);
    expect(m.offer(attributes(4, 6))).not.toBeNull();
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(2);
    expect(m.sessions.size).toBe(2);
    ended.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(m.offer(attributes(3, 7))).not.toBeNull();
    expect(m.sessions.size).toBe(1);
  });

  it("resumes queued work when the journal becomes idle even without a new primary revision", async () => {
    const m = setup();
    m.canRetainAlternate.mockReturnValue(false);
    m.start(attributes(4, 5));
    m.bidder.onAlternatePayloadAttributes(attributes(4, 6));
    await vi.advanceTimersByTimeAsync(200);
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(1);
    m.canRetainAlternate.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(550);
    expect(m.offer(attributes(4, 6))).not.toBeNull();
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(2);
  });

  it("preserves queued same-slot contexts through a primary switch without resetting the attempt cap", async () => {
    const m = setup();
    m.start(attributes(4, 5));
    for (let i = 10; i < 14; i++) m.bidder.onAlternatePayloadAttributes(attributes(i, i));
    await vi.advanceTimersByTimeAsync(100);
    m.start(attributes(8, 9));
    await vi.advanceTimersByTimeAsync(1700);
    expect(m.offer(attributes(10, 10))).toBeNull();
    for (let i = 11; i < 14; i++) expect(m.offer(attributes(i, i)), `retained context ${i}`).not.toBeNull();
    expect(m.offer(attributes(8, 9))).not.toBeNull();
    const before = m.payloadSource.prepare.mock.calls.length;
    m.bidder.onAlternatePayloadAttributes(attributes(14, 14));
    await vi.advanceTimersByTimeAsync(600);
    expect(m.payloadSource.prepare).toHaveBeenCalledTimes(before);
    expect(m.offer(attributes(14, 14))).toBeNull();
  });
});
