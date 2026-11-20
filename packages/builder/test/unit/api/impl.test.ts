import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {DOMAIN_BEACON_PROPOSER, DOMAIN_BUILDER_REQUEST_AUTH, ForkName} from "@lodestar/params";
import {ZERO_HASH, computeDomain, computeSigningRoot} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import * as utils from "@lodestar/utils";
import {BuilderBidStreamApi, getBuilderBidStreamApi} from "../../../src/api/bidStream.js";
import {
  BuilderApi,
  BuilderApiOptions,
  bidResponseBudgets,
  getBuilderApi,
  validateHttpBidResponseTiming,
} from "../../../src/api/impl.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {ProposerDutiesTracker} from "../../../src/services/proposerDutiesTracker.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";

const slot = 3;
const builderIndex = 1;
const proposerIndex = 7;
const authData = new TextEncoder().encode("builder.example.com");
const parentHash = Buffer.alloc(32, 4);
const parentRoot = Buffer.alloc(32, 5);
const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 0xaa));
const proposerKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
const proposerPubkey = proposerKey.toPublicKey().toBytes();
const otherKey = SecretKey.fromBytes(Buffer.alloc(32, 3));

describe("builder api", () => {
  let api: ReturnType<typeof getApiClientStub>;
  let clock: ClockMock;
  let bidStore: BidStore;
  let builderApi: BuilderApi;
  let streamApi: BuilderBidStreamApi;
  let signedBid: gloas.SignedExecutionPayloadBid;
  let controller: AbortController;

  beforeEach(() => {
    api = getApiClientStub();
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({
        data: [{slot, validatorIndex: proposerIndex, pubkey: proposerPubkey}],
        meta: {executionOptimistic: false, dependentRoot: "0x00"},
      })
    );
    api.beacon.publishBlockV2.mockResolvedValue(mockApiResponse({}));
    clock = new ClockMock();
    clock.currentSlot = slot;
    bidStore = new BidStore();
    controller = new AbortController();
    builderApi = createHttpApi();

    streamApi = createStreamApi();

    signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = slot;
    signedBid.message.builderIndex = builderIndex;
    signedBid.message.parentBlockHash = parentHash;
    signedBid.message.parentBlockRoot = parentRoot;
    signedBid.message.blockHash = Buffer.alloc(32, 6);
    signedBid.message.value = 5;
    bidStore.add(signedBid);
  });

  function createStreamApi(options: Partial<BuilderApiOptions> = {}): BuilderBidStreamApi {
    return getBuilderBidStreamApi(
      {
        config,
        logger: getMockedLogger(),
        clock,
        api,
        bidStore,
        proposerDutiesTracker: new ProposerDutiesTracker(api, clock),
        builderIndex,
        metrics: null,
        signal: controller.signal,
      },
      {authData, ...options}
    );
  }

  function createHttpApi(options: Partial<BuilderApiOptions> = {}): BuilderApi {
    return getBuilderApi(
      {
        config,
        logger: getMockedLogger(),
        clock,
        api,
        bidStore,
        proposerDutiesTracker: new ProposerDutiesTracker(api, clock),
        builderIndex,
        metrics: null,
        signal: controller.signal,
      },
      {authData, ...options}
    );
  }

  function signAuth(
    message: gloas.BuilderRequestAuth = {data: authData, slot},
    secretKey = proposerKey
  ): gloas.SignedBuilderRequestAuth {
    const domain = computeDomain(DOMAIN_BUILDER_REQUEST_AUTH, config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.gloas.BuilderRequestAuth, message, domain);
    return {message, signature: secretKey.sign(signingRoot).toBytes()};
  }

  function bidRequest(overrides: Partial<Parameters<BuilderApi["getExecutionPayloadBid"]>[0]> = {}) {
    return {
      slot,
      parentHash,
      parentRoot,
      proposerPubkey,
      requestAuth: signAuth(),
      dateMilliseconds: 0,
      timeoutMs: 500,
      ...overrides,
    };
  }

  function signBlock(secretKey = proposerKey): gloas.SignedBeaconBlock {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.proposerIndex = proposerIndex;
    block.message.body.signedExecutionPayloadBid = signedBid;
    const domain = config.getDomain(slot, DOMAIN_BEACON_PROPOSER);
    const signingRoot = computeSigningRoot(ssz.gloas.BeaconBlock, block.message, domain);
    block.signature = secretKey.sign(signingRoot).toBytes();
    return block;
  }

  describe("HTTP return reserve", () => {
    beforeEach(() => {
      vi.useFakeTimers({toFake: ["Date", "performance", "setTimeout", "clearTimeout"]});
      vi.setSystemTime(1_700_000_000_000);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("keeps the default formula across request ages and slot boundaries", () => {
      for (const remaining of [0, 20, 500, 12000]) {
        vi.spyOn(clock, "msToSlot").mockReturnValue(remaining - config.SLOT_DURATION_MS);
        for (const age of [-1, 0, 25, 158, 300, 1000]) {
          for (const timeout of [0, 150, 400, 1500]) {
            expect(bidResponseBudgets(clock, config, slot, age, timeout)).toEqual({
              waitMs: age < 0 ? 0 : Math.max(0, Math.min(timeout - 2 * age - 50, remaining)),
              hardStopMs: age < 0 ? 0 : Math.max(0, Math.min(timeout - age - 50, remaining)),
            });
          }
        }
      }
    });

    it("changes the return reserve without moving the original client deadline", () => {
      for (const cap of [0, 20, 60, 250, Infinity]) {
        const budget = bidResponseBudgets(clock, config, slot, 158, 400, {
          returnReserveCapMs: cap,
          responseMarginMs: 50,
        });
        expect(budget.hardStopMs).toBe(192);
        expect(budget.waitMs).toBe(Math.max(0, 192 - Math.min(158, cap)));
      }
    });

    it("can include a newer retained bid during the additional wait", async () => {
      builderApi = createHttpApi({httpReturnReserveCapMs: 60});
      const resolved = vi.fn();
      const response = builderApi
        .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now() - 158, timeoutMs: 400}))
        .then(resolved);
      await vi.advanceTimersByTimeAsync(100);
      const better = structuredClone(signedBid);
      better.message.value = 10;
      better.message.blockHash = Buffer.alloc(32, 9);
      bidStore.add(better);
      await vi.advanceTimersByTimeAsync(31);
      expect(resolved).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await response;
      expect(resolved).toHaveBeenCalledExactlyOnceWith({data: better, meta: {version: ForkName.gloas}});
    });

    it("never grants a fresh deadline after slow authentication", async () => {
      builderApi = createHttpApi({httpReturnReserveCapMs: 60});
      const duties = await api.validator.getProposerDutiesV2({epoch: 0});
      api.validator.getProposerDutiesV2.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        vi.setSystemTime(Date.now() - 10000);
        return duties;
      });
      const resolved = vi.fn();
      const response = builderApi
        .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now() - 158, timeoutMs: 400}))
        .then(resolved);
      await vi.advanceTimersByTimeAsync(131);
      expect(resolved).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await response;
      expect(resolved).toHaveBeenCalledOnce();
    });

    it("does not apply HTTP overrides to WebSocket deadlines", async () => {
      streamApi = createStreamApi({httpReturnReserveCapMs: 0, httpResponseMarginMs: 20});
      const stream = await streamApi.open(bidRequest({dateMilliseconds: Date.now() - 158, timeoutMs: 400}));
      expect(stream.deadline).toBe(34);
      expect(stream.hardDeadline?.monotonic).toBe(192);
    });

    it("fences a cancelled generation during the longer wait and at serialization", async () => {
      builderApi = createHttpApi({httpReturnReserveCapMs: 60});
      const lease = {generation: "0x0", ready: true, validUntil: 1000, validUntilUnixMs: Date.now() + 1000};
      bidStore.add(signedBid, {generation: "0x0", lease});
      const pending = builderApi.getExecutionPayloadBid(
        bidRequest({dateMilliseconds: Date.now() - 158, timeoutMs: 400})
      );
      await vi.advanceTimersByTimeAsync(100);
      lease.generation = "0x1";
      await vi.advanceTimersByTimeAsync(32);
      expect((await pending).status).toBe(204);
      expect(bidStore.has(signedBid)).toBe(true);

      lease.generation = "0x0";
      let guard: (() => boolean) | undefined;
      const response = builderApi.getExecutionPayloadBid(
        bidRequest({dateMilliseconds: Date.now() - 158, timeoutMs: 400}),
        {
          setResponseGuard: (value) => {
            guard = value;
          },
        }
      );
      await vi.advanceTimersByTimeAsync(132);
      expect((await response).data).toBe(signedBid);
      expect(guard?.()).toBe(true);
      lease.generation = "0x1";
      expect(guard?.()).toBe(false);
    });

    it("shows why edge substitution and a historical minimum cannot guarantee the caller deadline", () => {
      const wait = (age: number, timeout: number) => bidResponseBudgets(clock, config, slot, age, timeout).waitMs;
      // 90 ms before edge, 10 ms onward, 25 ms return. Edge-25 shifts an already running timeout.
      expect(100 + wait(100, 400) + 25).toBeLessThan(400);
      expect(100 + wait(35, 400) + 25).toBeGreaterThan(400);
      // Past minimum inbound 10 ms cannot bound today's 55 ms return and 30 ms scheduling cost.
      expect(40 + wait(40, 400) + 55 + 30).toBeLessThan(400);
      const minimumReserve = bidResponseBudgets(clock, config, slot, 40, 400, {
        returnReserveCapMs: 10,
        responseMarginMs: 50,
      });
      expect(40 + minimumReserve.waitMs + 55 + 30).toBeGreaterThan(400);
    });

    it.each([-1, NaN, Infinity, 1.5, 10_001])("rejects invalid return cap %s", (cap) => {
      expect(() => createHttpApi({httpReturnReserveCapMs: cap})).toThrow("httpReturnReserveCapMs");
    });

    it.each([-1, 0, 19, NaN, Infinity, 20.5, 1_001])("rejects invalid margin %s", (margin) => {
      expect(() => validateHttpBidResponseTiming({httpResponseMarginMs: margin})).toThrow("httpResponseMarginMs");
    });
  });

  describe("retained bid stream", () => {
    describe("fixed response bounds", () => {
      beforeEach(() => {
        vi.useFakeTimers({toFake: ["Date", "performance", "setTimeout", "clearTimeout"]});
        vi.setSystemTime(1_700_000_000_000);
      });

      afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
      });

      it.each([
        {transit: 200, timeout: 500, wait: 50, hard: 250},
        {transit: 202, timeout: 500, wait: 46, hard: 248},
        {transit: 182, timeout: 500, wait: 86, hard: 268},
        {transit: 0, timeout: 500, wait: 450, hard: 450},
        {transit: -1, timeout: 500, wait: 0, hard: 0},
        {transit: 500, timeout: 500, wait: 0, hard: 0},
      ])("captures original bounds for $transit ms inbound age", async ({transit, timeout, wait, hard}) => {
        const arrivedAt = Date.now();
        const stream = await streamApi.open(bidRequest({dateMilliseconds: arrivedAt - transit, timeoutMs: timeout}));
        expect(stream.deadline).toBe(wait);
        expect(stream.hardDeadline).toEqual({monotonic: hard, unixMs: arrivedAt + hard});
        expect(stream.deadline).toBeLessThanOrEqual(stream.hardDeadline?.monotonic ?? 0);
        expect(hard).toBeLessThanOrEqual(timeout);
      });

      it("never refreshes either bound after authentication or a wall-clock rollback", async () => {
        const arrivedAt = Date.now();
        const response = await api.validator.getProposerDutiesV2({epoch: 0});
        api.validator.getProposerDutiesV2.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          vi.setSystemTime(arrivedAt - 10_000);
          return response;
        });
        const pending = streamApi.open(bidRequest({dateMilliseconds: arrivedAt - 200}));
        await vi.advanceTimersByTimeAsync(100);
        const stream = await pending;
        expect(stream.deadline).toBe(50);
        expect(stream.hardDeadline).toEqual({monotonic: 250, unixMs: arrivedAt + 250});
        expect(performance.now()).toBe(100);
      });

      it("snapshots the slot boundary once, with both deadlines capped at its end", async () => {
        const arrivedAt = Date.now();
        const remaining = vi.spyOn(clock, "msToSlot").mockReturnValue(-11_980);
        const stream = await streamApi.open(bidRequest({dateMilliseconds: arrivedAt - 200}));
        expect(stream.deadline).toBe(20);
        expect(stream.hardDeadline).toEqual({monotonic: 20, unixMs: arrivedAt + 20});
        expect(remaining).toHaveBeenCalledOnce();
      });

      it.each([slot - 1, slot + 2])("grants no adaptive allowance to slot %i outside the accepted window", (target) => {
        expect(bidResponseBudgets(clock, config, target, 100, 500)).toEqual({waitMs: 0, hardStopMs: 0});
      });
    });

    it("authenticates the exact request context and observes later retained revisions", async () => {
      const started = performance.now();
      const stream = await streamApi.open(bidRequest({dateMilliseconds: Date.now(), timeoutMs: 500}));
      expect(stream.deadline).toBeGreaterThan(started);
      expect(stream.deadline).toBeLessThanOrEqual(started + 451);
      expect(stream.current()).toBe(signedBid);
      const notify = vi.fn();
      const unsubscribe = stream.subscribe(notify);
      const later = structuredClone(signedBid);
      later.message.value += 1;
      later.message.blockHash = Buffer.alloc(32, 8);
      bidStore.add(later);
      expect(notify).toHaveBeenCalledOnce();
      expect(stream.current()).toBe(later);
      expect(stream.canOffer(later)).toBe(true);
      const different = await streamApi.open(bidRequest({parentRoot: Buffer.alloc(32, 9)}));
      expect(different.current()).toBeNull();
      unsubscribe();
      controller.abort();
      expect(stream.canOffer(later)).toBe(false);
    });

    it.each([
      {requestAuth: signAuth({data: authData, slot: slot + 1}), statusCode: 400},
      {requestAuth: signAuth({data: new Uint8Array([1]), slot}), statusCode: 400},
      {requestAuth: signAuth(undefined, otherKey), statusCode: 401},
    ])("uses the HTTP authentication rules ($statusCode)", async ({requestAuth, statusCode}) => {
      await expect(streamApi.open(bidRequest({requestAuth}))).rejects.toMatchObject({statusCode});
    });

    it("enforces not-before for HTTP and each stream frame, including a backwards clock", async () => {
      const now = Date.now();
      const lease = {
        generation: "0x0",
        ready: true,
        validUntil: performance.now() + 10000,
        validUntilUnixMs: now + 10000,
      };
      bidStore.add(signedBid, {generation: "0x0", lease, doNotOfferBefore: now + 1});
      const wall = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        const stream = await streamApi.open(bidRequest());
        expect(stream.current()).toBeNull();
        expect((await builderApi.getExecutionPayloadBid(bidRequest())).status).toBe(204);
        wall.mockReturnValue(now + 1);
        expect(stream.current()).toBe(signedBid);
        expect((await builderApi.getExecutionPayloadBid(bidRequest())).data).toBe(signedBid);
        wall.mockReturnValue(now);
        expect(stream.canOffer(signedBid)).toBe(false);
        expect((await builderApi.getExecutionPayloadBid(bidRequest())).status).toBe(204);
        expect(bidStore.has(signedBid)).toBe(true);
      } finally {
        wall.mockRestore();
      }
    });

    it("withdraws future stream offers without losing previously signed reveal obligations", async () => {
      const lease = {
        generation: "0x0",
        ready: true,
        validUntil: performance.now() + 1000,
        validUntilUnixMs: Date.now() + 1000,
      };
      bidStore.add(signedBid, {generation: "0x0", lease});
      const stream = await streamApi.open(bidRequest());
      expect(stream.current()).toBe(signedBid);
      lease.generation = "0x1";
      expect(stream.current()).toBeNull();
      expect(stream.canOffer(signedBid)).toBe(false);
      expect(bidStore.has(signedBid)).toBe(true);
      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: signBlock()}})).resolves.toEqual({
        status: 202,
      });
    });

    it("fences HTTP and stream offers on FULL, EMPTY and parent branches but keeps old commitments", async () => {
      const lease = {
        generation: "0x0",
        ready: true,
        validUntil: performance.now() + 10000,
        validUntilUnixMs: Date.now() + 10000,
      };
      bidStore.add(signedBid, {generation: "0x0", lease});
      const branches = [
        {parentHash, parentRoot},
        {parentHash: Buffer.alloc(32, 7), parentRoot},
        {parentHash: Buffer.alloc(32, 7), parentRoot: Buffer.alloc(32, 8)},
      ].map((parent, i) => {
        const bid = structuredClone(signedBid);
        bid.message.parentBlockHash = parent.parentHash;
        bid.message.parentBlockRoot = parent.parentRoot;
        bid.message.blockHash = Buffer.alloc(32, 20 + i);
        bid.message.value = 10 + i;
        bidStore.add(bid, {generation: "0x0", lease});
        return {bid, request: bidRequest(parent)};
      });
      const streams = await Promise.all(branches.map(({request}) => streamApi.open(request)));
      for (const [i, {bid, request}] of branches.entries()) {
        expect(streams[i].current()).toBe(bid);
        expect((await builderApi.getExecutionPayloadBid(request)).data).toBe(bid);
      }
      lease.generation = "0x1";
      for (const [i, {bid, request}] of branches.entries()) {
        expect(streams[i].current()).toBeNull();
        expect(streams[i].canOffer(bid)).toBe(false);
        expect((await builderApi.getExecutionPayloadBid(request)).status).toBe(204);
        expect(bidStore.has(bid)).toBe(true);
        signedBid = bid;
        await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: signBlock()}})).resolves.toEqual({
          status: 202,
        });
      }
      const replacement = structuredClone(branches[1].bid);
      replacement.message.blockHash = Buffer.alloc(32, 30);
      replacement.message.value = 20;
      bidStore.add(replacement, {generation: "0x1", lease});
      expect(streams[1].current()).toBe(replacement);
      expect((await builderApi.getExecutionPayloadBid(branches[1].request)).data).toBe(replacement);
      expect(streams[0].current()).toBeNull();
      expect(streams[2].current()).toBeNull();
    });
  });

  describe("getExecutionPayloadBid", () => {
    it("stops offering an expired generation while accepting its already committed signed block", async () => {
      const lease = {
        generation: "0x2",
        ready: true,
        validUntil: performance.now() + 10000,
        validUntilUnixMs: Date.now() + 10000,
      };
      bidStore.add(signedBid, {generation: "0x2", lease});
      expect((await builderApi.getExecutionPayloadBid(bidRequest())).data).toBe(signedBid);
      const committed = signBlock();
      lease.generation = "0x3";
      expect((await builderApi.getExecutionPayloadBid(bidRequest())).status).toBe(204);
      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: committed}})).resolves.toEqual({
        status: 202,
      });
    });
    it("returns the published bid of the requested slot and parent", async () => {
      const response = await builderApi.getExecutionPayloadBid(bidRequest());

      expect(response).toEqual({data: signedBid, meta: {version: ForkName.gloas}});
    });

    it("returns no content if there is no bid on the requested parent", async () => {
      const response = await builderApi.getExecutionPayloadBid(bidRequest({parentHash: Buffer.alloc(32, 9)}));

      expect(response).toEqual({data: undefined, meta: {version: ForkName.gloas}, status: 204});
    });

    it.each([
      {id: "auth for another slot", requestAuth: signAuth({data: authData, slot: slot + 1}), statusCode: 400},
      {
        id: "auth data not agreed with the builder",
        requestAuth: signAuth({data: new TextEncoder().encode("other.example.com"), slot}),
        statusCode: 400,
      },
      {id: "auth signed by another key", requestAuth: signAuth(undefined, otherKey), statusCode: 401},
      {id: "malformed auth signature", requestAuth: {...signAuth(), signature: Buffer.alloc(96, 1)}, statusCode: 401},
    ])("rejects $id", async ({requestAuth, statusCode}) => {
      await expect(builderApi.getExecutionPayloadBid(bidRequest({requestAuth}))).rejects.toMatchObject({statusCode});
    });

    it("rejects a requester that is not the proposer of the slot", async () => {
      const request = bidRequest({
        proposerPubkey: otherKey.toPublicKey().toBytes(),
        requestAuth: signAuth(undefined, otherKey),
      });

      await expect(builderApi.getExecutionPayloadBid(request)).rejects.toMatchObject({statusCode: 400});
    });

    describe("response timing", () => {
      beforeEach(() => {
        vi.useFakeTimers({toFake: ["Date", "performance", "setTimeout", "clearTimeout"]});
        vi.setSystemTime(1_700_000_000_000);
      });

      afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
      });

      function addRevision(value: number, hash = value): gloas.SignedExecutionPayloadBid {
        const revision = {...signedBid, message: {...signedBid.message, value, blockHash: Buffer.alloc(32, hash)}};
        bidStore.add(revision);
        return revision;
      }

      it("uses the remaining request budget and returns the best bid at response time", async () => {
        const resolved = vi.fn();
        const response = builderApi
          .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now() - 100, timeoutMs: 500}))
          .then(resolved);

        await vi.advanceTimersByTimeAsync(150);
        addRevision(7);
        await vi.advanceTimersByTimeAsync(99);
        const best = addRevision(10);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await response;

        expect(resolved).toHaveBeenCalledExactlyOnceWith({data: best, meta: {version: ForkName.gloas}});
        expect(vi.getTimerCount()).toBe(0);
      });

      it("counts authentication time against the budget without treating it as network latency", async () => {
        const duties: Awaited<ReturnType<typeof api.validator.getProposerDutiesV2>> = mockApiResponse({
          data: [{slot, validatorIndex: proposerIndex, pubkey: proposerPubkey}],
          meta: {executionOptimistic: false, dependentRoot: "0x00"},
        });
        api.validator.getProposerDutiesV2.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(duties), 200))
        );
        const resolved = vi.fn();
        const response = builderApi
          .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now() - 100, timeoutMs: 500}))
          .then(resolved);

        await vi.advanceTimersByTimeAsync(249);
        const best = addRevision(10);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await response;
        expect(resolved).toHaveBeenCalledExactlyOnceWith({data: best, meta: {version: ForkName.gloas}});
      });

      it("does not add a wait when authentication already exhausted the budget", async () => {
        const duties: Awaited<ReturnType<typeof api.validator.getProposerDutiesV2>> = mockApiResponse({
          data: [{slot, validatorIndex: proposerIndex, pubkey: proposerPubkey}],
          meta: {executionOptimistic: false, dependentRoot: "0x00"},
        });
        api.validator.getProposerDutiesV2.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(duties), 300))
        );
        const response = builderApi.getExecutionPayloadBid(
          bidRequest({dateMilliseconds: Date.now() - 100, timeoutMs: 500})
        );
        await vi.advanceTimersByTimeAsync(300);
        expect((await response).data).toBe(signedBid);
        expect(vi.getTimerCount()).toBe(0);
      });

      it("can return a first bid that becomes ready while the request waits", async () => {
        const request = bidRequest({dateMilliseconds: Date.now(), parentHash: Buffer.alloc(32, 9), timeoutMs: 300});
        const response = builderApi.getExecutionPayloadBid(request);
        await vi.advanceTimersByTimeAsync(100);
        const bid = {...signedBid, message: {...signedBid.message, parentBlockHash: request.parentHash}};
        bidStore.add(bid);
        await vi.advanceTimersByTimeAsync(150);

        expect((await response).data).toBe(bid);
      });

      it("returns no content at the deadline if only other parents have bids", async () => {
        const response = builderApi.getExecutionPayloadBid(
          bidRequest({dateMilliseconds: Date.now(), parentRoot: Buffer.alloc(32, 9), timeoutMs: 300})
        );
        await vi.advanceTimersByTimeAsync(100);
        addRevision(10);
        await vi.advanceTimersByTimeAsync(150);
        expect(await response).toEqual({data: undefined, meta: {version: ForkName.gloas}, status: 204});
      });

      it("returns higher bids on successive requests while retaining every earlier offer", async () => {
        const first = builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now(), timeoutMs: 200}));
        await vi.advanceTimersByTimeAsync(150);
        expect((await first).data).toBe(signedBid);
        const oldBlock = signBlock();

        const second = builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now(), timeoutMs: 300}));
        await vi.advanceTimersByTimeAsync(100);
        const better = addRevision(10);
        addRevision(6);
        await vi.advanceTimersByTimeAsync(150);

        expect((await second).data).toBe(better);
        await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: oldBlock}})).resolves.toEqual({
          status: 202,
        });
      });

      it("gives overlapping requests independent deadlines and does not pin a bid at request arrival", async () => {
        const slow = builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now(), timeoutMs: 500}));
        await vi.advanceTimersByTimeAsync(50);
        const fast = builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now(), timeoutMs: 200}));
        await vi.advanceTimersByTimeAsync(150);
        expect((await fast).data).toBe(signedBid);
        const better = addRevision(10);
        await vi.advanceTimersByTimeAsync(250);
        expect((await slow).data).toBe(better);
      });

      it.each([
        {id: "expired request", age: 600, timeoutMs: 500},
        {id: "no time left for a reply", age: 240, timeoutMs: 500},
        {id: "exactly the reply reservation remaining", age: 225, timeoutMs: 500},
        {id: "future send timestamp", age: -1, timeoutMs: 500},
        {id: "zero timeout", age: 0, timeoutMs: 0},
      ])("returns immediately for $id", async ({age, timeoutMs}) => {
        const response = await builderApi.getExecutionPayloadBid(
          bidRequest({dateMilliseconds: Date.now() - age, timeoutMs})
        );
        expect(response.data).toBe(signedBid);
        expect(vi.getTimerCount()).toBe(0);
      });

      it("does not wait on a retained bid for a past slot", async () => {
        clock.currentSlot = slot + 1;
        const response = await builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now()}));
        expect(response.data).toBe(signedBid);
        expect(vi.getTimerCount()).toBe(0);
      });

      it("does not wait for a slot whose construction window has not begun", async () => {
        clock.currentSlot = slot - 2;
        const response = await builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now()}));
        expect(response.data).toBe(signedBid);
        expect(vi.getTimerCount()).toBe(0);
      });

      it("bounds even huge timeouts by the end of the proposal slot", async () => {
        const resolved = vi.fn();
        const response = builderApi
          .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now(), timeoutMs: Number.MAX_SAFE_INTEGER}))
          .then(resolved);
        await vi.advanceTimersByTimeAsync(11_999);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await response;
        expect(resolved).toHaveBeenCalledOnce();
      });

      it("only waits for the remaining part of the proposal slot", async () => {
        vi.spyOn(clock, "msToSlot").mockReturnValue(-11_900);
        const resolved = vi.fn();
        const response = builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now()})).then(resolved);
        await vi.advanceTimersByTimeAsync(99);
        const best = addRevision(10);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await response;
        expect(resolved).toHaveBeenCalledExactlyOnceWith({data: best, meta: {version: ForkName.gloas}});
      });

      it("serves the best retained bid immediately if the slot's window has already elapsed", async () => {
        vi.spyOn(clock, "msToSlot").mockReturnValue(-12_001);
        const response = await builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now()}));
        expect(response.data).toBe(signedBid);
        expect(vi.getTimerCount()).toBe(0);
      });

      it("does not wait on an unauthenticated request with a valid timing budget", async () => {
        await expect(
          builderApi.getExecutionPayloadBid(
            bidRequest({dateMilliseconds: Date.now(), requestAuth: signAuth(undefined, otherKey)})
          )
        ).rejects.toMatchObject({statusCode: 401});
        expect(vi.getTimerCount()).toBe(0);
      });

      it("cancels the wait when the builder shuts down", async () => {
        const response = builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now()}));
        const rejected = expect(response).rejects.toMatchObject({statusCode: 503});
        await vi.advanceTimersByTimeAsync(100);
        controller.abort();
        await rejected;
        expect(vi.getTimerCount()).toBe(0);
      });

      it("does not offer a new bid after shutdown", async () => {
        controller.abort();
        await expect(
          builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now()}))
        ).rejects.toMatchObject({
          statusCode: 503,
        });
        expect(vi.getTimerCount()).toBe(0);
      });

      it("checks shutdown again when a completed wait resumes", async () => {
        vi.spyOn(utils, "sleep").mockImplementationOnce(async () => {
          controller.abort();
        });
        await expect(
          builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now()}))
        ).rejects.toMatchObject({
          statusCode: 503,
        });
      });

      it("waits for an in-flight revision whose retention finishes after construction stops", async () => {
        vi.spyOn(clock, "msToSlot").mockReturnValue(-1100);
        const resolved = vi.fn();
        const response = builderApi
          .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now() - 50, timeoutMs: 500}))
          .then(resolved);
        await vi.advanceTimersByTimeAsync(150);
        const best = addRevision(10);
        await vi.advanceTimersByTimeAsync(199);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await response;
        expect(resolved).toHaveBeenCalledExactlyOnceWith({data: best, meta: {version: ForkName.gloas}});
      });

      it("uses a request's own timeout before the proposal slot begins", async () => {
        clock.currentSlot = slot - 1;
        const resolved = vi.fn();
        const response = builderApi
          .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now() - 100, timeoutMs: 5000}))
          .then(resolved);
        await vi.advanceTimersByTimeAsync(4749);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await response;
        expect(resolved).toHaveBeenCalledOnce();
      });

      it("uses a small remaining budget without consuming the reply reservation", async () => {
        const resolved = vi.fn();
        const response = builderApi
          .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now() - 224, timeoutMs: 500}))
          .then(resolved);
        await vi.advanceTimersByTimeAsync(1);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await response;
        expect(resolved).toHaveBeenCalledOnce();
      });

      it("bounds concurrent waits and serves overflow immediately without blocking subsequent requests", async () => {
        const resolved = vi.fn();
        const request = bidRequest({dateMilliseconds: Date.now()});
        const responses = Array.from({length: 65}, () => builderApi.getExecutionPayloadBid(request).then(resolved));
        await vi.advanceTimersByTimeAsync(0);
        expect(resolved).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(64);
        expect((await builderApi.getExecutionPayloadBid(bidRequest())).data).toBe(signedBid);
        expect(vi.getTimerCount()).toBe(64);
        await vi.advanceTimersByTimeAsync(450);
        await Promise.all(responses);
        expect(resolved).toHaveBeenCalledTimes(65);
        expect(vi.getTimerCount()).toBe(0);

        const next = builderApi.getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now()})).then(resolved);
        await vi.advanceTimersByTimeAsync(449);
        expect(resolved).toHaveBeenCalledTimes(65);
        await vi.advanceTimersByTimeAsync(1);
        await next;
        expect(resolved).toHaveBeenCalledTimes(66);
      });

      it("uses a monotonic budget if the wall clock moves while authenticating", async () => {
        const duties: Awaited<ReturnType<typeof api.validator.getProposerDutiesV2>> = mockApiResponse({
          data: [{slot, validatorIndex: proposerIndex, pubkey: proposerPubkey}],
          meta: {executionOptimistic: false, dependentRoot: "0x00"},
        });
        api.validator.getProposerDutiesV2.mockImplementation(async () => {
          vi.setSystemTime(Date.now() - 60_000);
          return duties;
        });
        const resolved = vi.fn();
        const response = builderApi
          .getExecutionPayloadBid(bidRequest({dateMilliseconds: Date.now(), timeoutMs: 300}))
          .then(resolved);
        await vi.advanceTimersByTimeAsync(249);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await response;
        expect(resolved).toHaveBeenCalledOnce();
      });
    });
  });

  describe("submitBuilderPreferences", () => {
    it("accepts preferences of the proposer of a slot", async () => {
      const response = await builderApi.submitBuilderPreferences({
        proposerPubkey,
        request: {preferences: {maxExecutionPayment: 1n}, auth: signAuth()},
      });

      expect(response).toEqual({status: 202});
    });

    it("rejects preferences for a slot that has passed", async () => {
      clock.currentSlot = slot + 1;

      await expect(
        builderApi.submitBuilderPreferences({
          proposerPubkey,
          request: {preferences: {maxExecutionPayment: 1n}, auth: signAuth()},
        })
      ).rejects.toMatchObject({statusCode: 400});
    });

    it("rejects preferences with an invalid signature", async () => {
      await expect(
        builderApi.submitBuilderPreferences({
          proposerPubkey,
          request: {preferences: {maxExecutionPayment: 1n}, auth: signAuth(undefined, otherKey)},
        })
      ).rejects.toMatchObject({statusCode: 401});
    });
  });

  describe("submitSignedBeaconBlock", () => {
    it("serves B but still accepts a proposer selecting an earlier A", async () => {
      const first = (await builderApi.getExecutionPayloadBid(bidRequest())).data;
      const oldBlock = signBlock();
      const newer = {...signedBid, message: {...signedBid.message, blockHash: Buffer.alloc(32, 9), value: 10}};
      bidStore.add(newer);
      expect((await builderApi.getExecutionPayloadBid(bidRequest())).data).toBe(newer);
      expect(first).toBe(signedBid);
      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: oldBlock}})).resolves.toEqual({status: 202});
      signedBid = {...signedBid, message: {...signedBid.message, value: 6}};
      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: signBlock()}})).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it("publishes a block that commits to one of our bids", async () => {
      const block = signBlock();

      const response = await builderApi.submitSignedBeaconBlock({signedBlock: {data: block}});

      expect(response).toEqual({status: 202});
      expect(api.beacon.publishBlockV2).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({signedBlockContents: {signedBlock: block}})
      );
    });

    it("rejects a block that commits to the bid of another builder", async () => {
      const block = signBlock();
      block.message.body.signedExecutionPayloadBid = {
        ...signedBid,
        message: {...signedBid.message, builderIndex: builderIndex + 1},
      };

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: block}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });

    it("rejects a block that commits to a bid we did not publish", async () => {
      const block = signBlock();
      block.message.body.signedExecutionPayloadBid = {
        ...signedBid,
        message: {...signedBid.message, blockHash: Buffer.alloc(32, 9)},
      };

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: block}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });

    it("rejects a block that is not signed by the proposer of the slot", async () => {
      await expect(
        builderApi.submitSignedBeaconBlock({signedBlock: {data: signBlock(otherKey)}})
      ).rejects.toMatchObject({statusCode: 400});
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });
  });
});
