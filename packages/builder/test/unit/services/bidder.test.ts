import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {BuilderStatus, ssz} from "@lodestar/types";
import {fromHex, toHex, toRootHex} from "@lodestar/utils";
import {Bidder, type BidderOptions, PayloadAttributesEvent} from "../../../src/services/bidder.js";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidPublisher} from "../../../src/services/bidPublisher.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {biddingOptions, createBiddingModules, getPayloadSourceStub} from "../utils/bidding.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockBuiltPayload} from "../utils/payload.js";

const slot = 1;
const builderIndex = 1;
const dependentRoot = toRootHex(Buffer.alloc(32, 7));
const parentBlockRoot = Buffer.alloc(32, 4);
const parentBlockHash = Buffer.alloc(32, 5);
const prevRandao = Buffer.alloc(32, 6);
const proposerFeeRecipient = Buffer.alloc(20, 8);
// ClockMock is at the start of slot 0, the deadline is at 85% of that slot
const msToDeadline = 10_200;

describe("Bidder", () => {
  let api: ReturnType<typeof getApiClientStub>;
  let logger: ReturnType<typeof getMockedLogger>;
  let payloadSource: ReturnType<typeof getPayloadSourceStub>;
  let payloadStore: PayloadStore;
  let proposerPreferencesTracker: ProposerPreferencesTracker;
  let controller: AbortController;

  beforeEach(() => {
    vi.useFakeTimers({now: 0});
    api = getApiClientStub();
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({data: [], meta: {executionOptimistic: false, dependentRoot}})
    );
    api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
    logger = getMockedLogger();
    payloadSource = getPayloadSourceStub();
    payloadSource.prepare.mockResolvedValue({sourceId: "el", fork: ForkName.gloas, payloadId: "0x01"});
    payloadSource.getPayload.mockResolvedValue({
      ...mockBuiltPayload({slot, parentHash: parentBlockHash, prevRandao}),
      fork: ForkName.gloas,
    });
    payloadStore = new PayloadStore();
    proposerPreferencesTracker = new ProposerPreferencesTracker();
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  function createBidder(
    getBuilderStatus?: () => {status: BuilderStatus | undefined; balance: number | undefined},
    dryRun = false,
    updateOptions?: Pick<BidderOptions, "updateIntervalMs" | "updateCutoffBps" | "maxRevisionsPerSlot">
  ): {
    bidder: Bidder;
    ledger: BidLedger;
    bidStore: BidStore;
  } {
    const config = getConfig(ForkName.gloas);
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    return createBiddingModules({
      api,
      config,
      logger,
      clock: new ClockMock(),
      builderSigner: new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), {
        secretKey,
        publicKey: secretKey.toPublicKey(),
      }),
      proposerPreferencesTracker,
      payloadStore,
      payloadSource,
      signal: controller.signal,
      index: builderIndex,
      getBuilderStatus,
      dryRun,
      updateOptions,
    });
  }

  function addProposerPreferences(): void {
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = slot;
    preferences.message.dependentRoot = Buffer.alloc(32, 7);
    preferences.message.feeRecipient = proposerFeeRecipient;
    preferences.message.targetGasLimit = 60_000_000n;
    proposerPreferencesTracker.onProposerPreferences(preferences);
  }

  function payloadAttributesEvent(): PayloadAttributesEvent {
    const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
    data.proposalSlot = slot;
    data.parentBlockRoot = parentBlockRoot;
    data.parentBlockHash = parentBlockHash;
    data.safeBlockHash = Buffer.alloc(32, 2);
    data.finalizedBlockHash = Buffer.alloc(32, 3);
    data.payloadAttributes.prevRandao = prevRandao;
    data.payloadAttributes.targetGasLimit = 30_000_000n;
    return {version: ForkName.gloas, data};
  }

  it("builds in dry-run mode without signing, publishing, or storing a bid", async () => {
    const sign = vi.spyOn(BuilderSigner.prototype, "signExecutionPayloadBid");
    addProposerPreferences();
    const {bidder, ledger, bidStore} = createBidder(undefined, true);
    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await bidding;

    expect(payloadSource.getPayload).toHaveBeenCalledOnce();
    expect(sign).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    expect(ledger.hasSubmitted(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(false);
    expect(bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBeNull();
    expect(payloadStore.has(toRootHex(mockBuiltPayload().executionPayload.blockHash))).toBe(false);
    expect(logger.info).toHaveBeenCalledWith("Built payload without bidding", expect.objectContaining({slot}));
    sign.mockRestore();
  });

  it("ignores pre-Gloas attributes even with an active assumed identity", async () => {
    const {bidder} = createBidder(() => ({status: "active", balance: 10_000_000_000}));
    await bidder.onPayloadAttributes({version: ForkName.fulu, data: ssz.fulu.SSEPayloadAttributes.defaultValue()});
    expect(payloadSource.prepare).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("builds on the emitted parent and publishes a bid at the deadline", async () => {
    addProposerPreferences();
    const {bidder, ledger, bidStore} = createBidder();

    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline - 1);
    expect(payloadSource.prepare).toHaveBeenCalledExactlyOnceWith(
      {
        fork: ForkName.gloas,
        forkchoiceState: {
          headBlockHash: toRootHex(parentBlockHash),
          safeBlockHash: toRootHex(Buffer.alloc(32, 2)),
          finalizedBlockHash: toRootHex(Buffer.alloc(32, 3)),
        },
        payloadAttributes: expect.objectContaining({
          prevRandao,
          suggestedFeeRecipient: toHex(Buffer.alloc(20, 9)),
          targetGasLimit: 60_000_000n,
        }),
      },
      expect.any(AbortSignal)
    );
    expect(payloadSource.getPayload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await bidding;

    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    const {signedExecutionPayloadBid} = api.beacon.publishExecutionPayloadBid.mock.calls[0][0];
    expect(signedExecutionPayloadBid.message).toMatchObject({
      slot,
      builderIndex,
      parentBlockRoot,
      parentBlockHash,
      prevRandao,
      feeRecipient: proposerFeeRecipient,
      // 90% of the 1 ETH payload value
      value: 900_000_000,
    });
    const blockHash = toRootHex(signedExecutionPayloadBid.message.blockHash);
    expect(payloadStore.has(blockHash)).toBe(true);
    expect(ledger.hasSubmitted(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(true);
    expect(bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(signedExecutionPayloadBid);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("bids once for repeated payload attributes of the same parent", async () => {
    addProposerPreferences();
    const {bidder} = createBidder();

    const first = bidder.onPayloadAttributes(payloadAttributesEvent());
    const duplicate = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await Promise.all([first, duplicate]);
    await bidder.onPayloadAttributes(payloadAttributesEvent());

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledOnce();
    expect(payloadSource.prepare).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("retains a successfully submitted bid if cancellation arrives during its acknowledgement", async () => {
    addProposerPreferences();
    const {bidder, bidStore} = createBidder();
    api.beacon.publishExecutionPayloadBid.mockImplementation(async () => {
      controller.abort();
      return mockApiResponse({});
    });
    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await bidding;
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    const {signedExecutionPayloadBid} = api.beacon.publishExecutionPayloadBid.mock.calls[0][0];
    expect(bidStore.has(signedExecutionPayloadBid)).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("improves API bids after gossip while retaining both payload commitments", async () => {
    addProposerPreferences();
    payloadSource.supportsUpdates = true;
    const {bidder, ledger, bidStore} = createBidder(undefined, false, {updateIntervalMs: 100, updateCutoffBps: 1000});
    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(0);
    const first = bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot));
    expect(first).not.toBeNull();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(msToDeadline);
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    const next = {
      ...mockBuiltPayload({slot, parentHash: parentBlockHash, prevRandao, blockHash: Buffer.alloc(32, 12)}),
      fork: ForkName.gloas as const,
      executionPayloadValue: 2_000_000_000_000_000_000n,
    };
    payloadSource.getPayload.mockResolvedValue(next);
    await vi.advanceTimersByTimeAsync(100);
    const second = bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot));
    if (!first || !second) throw Error("Expected both bid revisions");
    expect(second.message.value).toBeGreaterThan(first.message.value);
    if (!first) throw Error("Expected first bid");
    expect(bidStore.has(first)).toBe(true);
    expect(payloadStore.has(toRootHex(first.message.blockHash))).toBe(true);
    expect(payloadStore.has(toRootHex(second.message.blockHash))).toBe(true);
    expect(ledger.getBidsForSlot(slot)).toHaveLength(2);
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    await bidding;
    expect(payloadSource.prepare).toHaveBeenCalledOnce();
    expect(payloadSource.release).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("retries an unchanged leased candidate after its durable write outlives the first lease", async () => {
    addProposerPreferences();
    payloadSource.supportsUpdates = true;
    const lease = {generation: "0x1", ready: true, validUntil: 0, validUntilUnixMs: 0};
    const candidate = {
      ...mockBuiltPayload({slot, parentHash: parentBlockHash, prevRandao}),
      fork: ForkName.gloas as const,
      offerEligibility: {generation: "0x1", lease},
    };
    payloadSource.getPayload.mockImplementation(async () => {
      lease.validUntil = performance.now() + 250;
      lease.validUntilUnixMs = Date.now() + 250;
      return candidate;
    });
    const original = BidPublisher.prototype.prepare;
    const prepare = vi.spyOn(BidPublisher.prototype, "prepare").mockImplementation(async function (
      this: BidPublisher,
      bid,
      revisionLimit,
      offered
    ) {
      const signed = await original.call(this, bid, revisionLimit, offered);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return signed;
    });
    try {
      const {bidder, bidStore} = createBidder(undefined, false, {updateIntervalMs: 25, updateCutoffBps: 1000});
      const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
      await vi.advanceTimersByTimeAsync(300);
      expect(bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBeNull();
      await vi.advanceTimersByTimeAsync(msToDeadline - 300);
      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
      expect(prepare).toHaveBeenCalledOnce();
      const signed = api.beacon.publishExecutionPayloadBid.mock.calls[0][0].signedExecutionPayloadBid;
      expect(bidStore.has(signed)).toBe(true);
      controller.abort();
      await bidding;
    } finally {
      prepare.mockRestore();
    }
  });

  it("retains a directly published signature when gossip delivery has an uncertain result", async () => {
    addProposerPreferences();
    api.beacon.publishExecutionPayloadBid.mockRejectedValue(new Error("connection lost after send"));
    const {bidder, bidStore} = createBidder();
    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await bidding;
    const signed = api.beacon.publishExecutionPayloadBid.mock.calls[0][0].signedExecutionPayloadBid;
    expect(bidStore.has(signed)).toBe(true);
    expect(payloadStore.has(toRootHex(signed.message.blockHash))).toBe(true);
  });

  it.each([64, 256])("rejects before retaining or signing at an admission limit of %i revisions", async (limit) => {
    addProposerPreferences();
    payloadSource.supportsUpdates = true;
    const {bidder, ledger, bidStore} = createBidder(undefined, false, {
      updateIntervalMs: 100,
      updateCutoffBps: 1000,
      maxRevisionsPerSlot: limit,
    });
    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(0);
    const first = bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot));
    if (!first) throw Error("Expected the first advertised bid");
    const firstRecord = ledger.getBidsForSlot(slot)[0];
    for (let i = 1; i < limit; i++) {
      const root = Buffer.alloc(32);
      root.writeUInt32BE(i, 28);
      ledger.recordRevision({...firstRecord, signedBidRoot: toRootHex(root)});
    }
    const sign = vi.spyOn(BuilderSigner.prototype, "signExecutionPayloadBid");
    const bytes = payloadStore.bytes;
    const next = mockBuiltPayload({slot, parentHash: parentBlockHash, prevRandao, blockHash: Buffer.alloc(32, 12)});
    payloadSource.getPayload.mockResolvedValue({
      ...next,
      fork: ForkName.gloas,
      executionPayloadValue: 2_000_000_000_000_000_000n,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(sign).not.toHaveBeenCalled();
    expect(payloadStore.bytes).toBe(bytes);
    expect(payloadStore.size).toBe(1);
    expect(payloadStore.has(toRootHex(next.executionPayload.blockHash))).toBe(false);
    expect(payloadStore.has(toRootHex(first.message.blockHash))).toBe(true);
    expect(bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(first);
    expect(ledger.getBidsForSlot(slot)).toHaveLength(limit);
    controller.abort();
    await bidding;
    sign.mockRestore();
  });

  it.each(["revisions", "payloads"])(
    "still gossips its best bid after reaching %s capacity before the deadline",
    async (capacity) => {
      addProposerPreferences();
      payloadSource.supportsUpdates = true;
      if (capacity === "payloads") payloadStore = new PayloadStore(256 * 1024 * 1024, 2);
      const {bidder, bidStore} = createBidder(undefined, false, {
        updateIntervalMs: 100,
        updateCutoffBps: 1000,
        maxRevisionsPerSlot: capacity === "revisions" ? 2 : 256,
      });
      let revision = 0;
      payloadSource.getPayload.mockImplementation(async () => ({
        ...mockBuiltPayload({
          slot,
          parentHash: parentBlockHash,
          prevRandao,
          blockHash: Buffer.alloc(32, ++revision),
          valueGwei: revision * 1_000_000_000,
        }),
        fork: ForkName.gloas,
      }));
      const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
      await vi.advanceTimersByTimeAsync(500);
      expect(payloadSource.getPayload).toHaveBeenCalledTimes(3);
      expect(payloadStore.size).toBe(2);
      expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
      const best = bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot));
      await vi.advanceTimersByTimeAsync(msToDeadline - 500);
      await bidding;
      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledExactlyOnceWith(
        {signedExecutionPayloadBid: best},
        {signal: expect.any(AbortSignal)}
      );
      expect(payloadSource.getPayload).toHaveBeenCalledTimes(3);
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it.each([0, -1, 257, 1.5, NaN, Infinity])("rejects invalid programmatic revision limit %s", (limit) => {
    expect(() => createBidder(undefined, false, {maxRevisionsPerSlot: limit})).toThrow(RangeError);
  });

  it("cancels a replaced parent without deleting its already advertised bid", async () => {
    addProposerPreferences();
    payloadSource.supportsUpdates = true;
    const {bidder, bidStore} = createBidder(undefined, false, {updateIntervalMs: 100, updateCutoffBps: 1000});
    const firstBuild = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(0);
    const first = bidStore.get(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot));
    const event = payloadAttributesEvent();
    event.data.parentBlockRoot = Buffer.alloc(32, 15);
    payloadSource.getPayload.mockResolvedValue({
      ...mockBuiltPayload({slot, parentHash: parentBlockHash, prevRandao, blockHash: Buffer.alloc(32, 16)}),
      fork: ForkName.gloas,
    });
    const secondBuild = bidder.onPayloadAttributes(event);
    await vi.advanceTimersByTimeAsync(0);
    await firstBuild;
    expect(payloadSource.release).toHaveBeenCalledOnce();
    if (!first) throw Error("Expected first bid");
    expect(bidStore.has(first)).toBe(true);
    controller.abort();
    await secondBuild;
    expect(payloadSource.release).toHaveBeenCalledTimes(2);
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("currently keeps only the last of four head/parent FULL/EMPTY construction contexts active", async () => {
    addProposerPreferences();
    payloadSource.supportsUpdates = true;
    const {bidder, bidStore} = createBidder(undefined, false, {updateIntervalMs: 100, updateCutoffBps: 1000});
    const requests = new Map<string, Parameters<typeof payloadSource.prepare>[0]>();
    payloadSource.prepare.mockImplementation(async (request) => {
      const payloadId = String(requests.size + 1);
      requests.set(payloadId, request);
      return {sourceId: "el", fork: ForkName.gloas, payloadId};
    });
    payloadSource.getPayload.mockImplementation(async (handle) => {
      const request = requests.get(handle.payloadId);
      if (!request) throw Error("Missing test request");
      return {
        ...mockBuiltPayload({
          slot,
          parentHash: fromHex(request.forkchoiceState.headBlockHash),
          prevRandao,
          blockHash: Buffer.alloc(32, 20 + Number(handle.payloadId)),
        }),
        fork: ForkName.gloas,
      };
    });
    const contexts = [
      {root: parentBlockRoot, hash: Buffer.alloc(32, 16)},
      {root: parentBlockRoot, hash: parentBlockHash},
      {root: Buffer.alloc(32, 15), hash: parentBlockHash},
      {root: Buffer.alloc(32, 15), hash: Buffer.alloc(32, 17)},
    ];
    const builds: Promise<void>[] = [];
    for (const context of contexts) {
      const event = payloadAttributesEvent();
      event.data.parentBlockRoot = context.root;
      event.data.parentBlockHash = context.hash;
      builds.push(bidder.onPayloadAttributes(event));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(payloadSource.prepare).toHaveBeenCalledTimes(4);
    expect(payloadSource.release).toHaveBeenCalledTimes(3);
    for (const context of contexts) {
      expect(bidStore.get(slot, toRootHex(context.hash), toRootHex(context.root))).not.toBeNull();
    }
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    controller.abort();
    await Promise.all(builds);
    expect(payloadSource.release).toHaveBeenCalledTimes(4);
    expect(payloadStore.size).toBe(4);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("currently loses unsealed primary work if all four parent contexts arrive together", async () => {
    addProposerPreferences();
    payloadSource.supportsUpdates = true;
    const {bidder, bidStore} = createBidder(undefined, false, {updateIntervalMs: 100, updateCutoffBps: 1000});
    const contexts = [
      {root: parentBlockRoot, hash: Buffer.alloc(32, 16)},
      {root: parentBlockRoot, hash: parentBlockHash},
      {root: Buffer.alloc(32, 15), hash: parentBlockHash},
      {root: Buffer.alloc(32, 15), hash: Buffer.alloc(32, 17)},
    ];
    payloadSource.getPayload.mockResolvedValue({
      ...mockBuiltPayload({slot, parentHash: contexts[3].hash, prevRandao}),
      fork: ForkName.gloas,
    });
    const builds = contexts.map(({root, hash}) => {
      const event = payloadAttributesEvent();
      event.data.parentBlockRoot = root;
      event.data.parentBlockHash = hash;
      return bidder.onPayloadAttributes(event);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(payloadSource.prepare).toHaveBeenCalledOnce();
    expect(payloadSource.prepare.mock.calls[0][0].forkchoiceState.headBlockHash).toBe(toRootHex(contexts[3].hash));
    for (const context of contexts.slice(0, 3)) {
      expect(bidStore.get(slot, toRootHex(context.hash), toRootHex(context.root))).toBeNull();
    }
    controller.abort();
    await Promise.all(builds);
    expect(payloadSource.release).toHaveBeenCalledOnce();
  });

  it("does not build without proposer preferences", async () => {
    const {bidder} = createBidder();

    await bidder.onPayloadAttributes(payloadAttributesEvent());

    expect(payloadSource.prepare).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("refreshes the preference dependent root for a changed parent in the same epoch", async () => {
    const {bidder} = createBidder();
    await bidder.onPayloadAttributes(payloadAttributesEvent());
    expect(payloadSource.prepare).not.toHaveBeenCalled();

    const nextRoot = Buffer.alloc(32, 19);
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = slot;
    preferences.message.dependentRoot = nextRoot;
    preferences.message.feeRecipient = proposerFeeRecipient;
    preferences.message.targetGasLimit = 60_000_000n;
    proposerPreferencesTracker.onProposerPreferences(preferences);
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({data: [], meta: {executionOptimistic: false, dependentRoot: toRootHex(nextRoot)}})
    );

    const event = payloadAttributesEvent();
    event.data.parentBlockRoot = Buffer.alloc(32, 15);
    const bidding = bidder.onPayloadAttributes(event);
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await bidding;

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
    expect(payloadSource.prepare).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it.each([
    {status: "pending", balance: 10_000_000_000},
    {status: undefined, balance: undefined},
    {status: "active", balance: biddingOptions.minOperatingBalanceGwei - 1},
    // Coverable balance is below 90% of the 1 ETH payload value
    {status: "active", balance: 1_800_000_000},
  ] as const)("does not bid with builder status $status and balance $balance", async (builderStatus) => {
    addProposerPreferences();
    const {bidder, ledger} = createBidder(() => builderStatus);

    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await bidding;

    expect(payloadSource.getPayload).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    expect(ledger.hasSubmitted(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(false);
  });

  it("logs a failed build and bids again for a later attempt", async () => {
    addProposerPreferences();
    payloadSource.getPayload.mockRejectedValueOnce(new Error("unknown payload"));
    const {bidder} = createBidder();

    const failed = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await failed;
    expect(logger.error).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();

    vi.setSystemTime(0);
    const retry = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await retry;
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
  });
});
