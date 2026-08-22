import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, MIN_DEPOSIT_AMOUNT} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {ProportionalBidPolicy} from "../../../src/services/bidPolicy.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {Ledger} from "../../../src/services/ledger.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {PayloadAttributesEvent, SlotBidder, SlotBidderOpts} from "../../../src/services/slotBidder.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";
import {FakePayloadSource, mockBuiltPayload} from "../utils/payload.js";

describe("SlotBidder", () => {
  const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 9));
  const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
  const signer = new BuilderSigner(config, {publicKey: secretKey.toPublicKey(), secretKey});
  const builderIndex = 7;
  const executionFeeRecipient = Buffer.alloc(20, 0xbb);
  const proposerFeeRecipient = Buffer.alloc(20, 0xaa);
  const slot = 10;
  const parentBlockRoot = Buffer.alloc(32, 1);
  const parentBlockHash = Buffer.alloc(32, 2);
  const prevRandao = Buffer.alloc(32, 3);
  const safeBlockHash = toRootHex(Buffer.alloc(32, 4));
  const finalizedBlockHash = toRootHex(Buffer.alloc(32, 5));
  const balanceGwei = 100 * MIN_DEPOSIT_AMOUNT;

  const opts: SlotBidderOpts = {
    deadlineBps: 8500,
    prepareRetryMs: 250,
    getPayloadTimeoutMs: 1000,
    minOperatingBalanceGwei: 2 * MIN_DEPOSIT_AMOUNT,
  };

  let logger: ReturnType<typeof getMockedLogger>;
  let clock: ClockMock;
  let api: ReturnType<typeof getApiClientStub>;
  let source: FakePayloadSource;
  let store: PayloadStore;
  let ledger: Ledger;
  let preferences: ProposerPreferencesTracker;
  let builderStatus: {status: gloas.BuilderStatus | undefined; balance: number | undefined};
  let bidder: SlotBidder;

  function payloadAttributesEvent(overrides: Partial<gloas.SSEPayloadAttributes> = {}): PayloadAttributesEvent {
    const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
    data.proposalSlot = slot;
    data.parentBlockRoot = parentBlockRoot;
    data.parentBlockHash = parentBlockHash;
    data.payloadAttributes.timestamp = 123;
    data.payloadAttributes.prevRandao = prevRandao;
    data.payloadAttributes.parentBeaconBlockRoot = parentBlockRoot;
    data.payloadAttributes.slotNumber = slot;
    data.payloadAttributes.targetGasLimit = 30_000_000n;
    return {version: ForkName.gloas, data: {...data, ...overrides}, safeBlockHash, finalizedBlockHash};
  }

  function createBidder(sources = [source]): SlotBidder {
    return new SlotBidder(
      {
        config,
        logger,
        clock,
        api,
        signer,
        sources,
        store,
        policy: new ProportionalBidPolicy({shareBps: 9000, fixedCostGwei: 0, minValueGwei: 0}),
        ledger,
        preferences,
        getBuilderStatus: () => builderStatus,
        builderIndex,
        executionFeeRecipient,
        metrics: null,
      },
      opts
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    logger = getMockedLogger();
    clock = new ClockMock();
    // Start of the slot before the target slot, deadline is at 85% of the slot
    clock.currentSlot = slot - 1;
    clock.msToSlotValue = config.SLOT_DURATION_MS;
    api = getApiClientStub();
    api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
    source = new FakePayloadSource("el");
    source.getPayload.mockResolvedValue(mockBuiltPayload({slot, parentHash: parentBlockHash, prevRandao}));
    store = new PayloadStore();
    ledger = new Ledger();
    preferences = new ProposerPreferencesTracker();
    const prefs = ssz.gloas.SignedProposerPreferences.defaultValue();
    prefs.message.proposalSlot = slot;
    prefs.message.feeRecipient = proposerFeeRecipient;
    preferences.onProposerPreferences(prefs);
    builderStatus = {status: "active", balance: balanceGwei};
    bidder = createBidder();
  });

  afterEach(() => {
    bidder.close();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  const deadlineMs = config.getSlotComponentDurationMs(opts.deadlineBps);

  it("starts a build on payload attributes and bids at the deadline", async () => {
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(source.prepare).toHaveBeenCalledOnce();
    const request = source.prepare.mock.calls[0][0];
    expect(request.fork).toEqual(ForkName.gloas);
    expect(request.forkchoiceState).toEqual({
      headBlockHash: toRootHex(parentBlockHash),
      safeBlockHash,
      finalizedBlockHash,
    });
    expect(request.payloadAttributes.suggestedFeeRecipient).toEqual(toHex(executionFeeRecipient));
    expect(request.payloadAttributes.targetGasLimit).toEqual(30_000_000n);
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(source.getPayload).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    const {signedExecutionPayloadBid} = api.beacon.publishExecutionPayloadBid.mock.calls[0][0];
    const bid = signedExecutionPayloadBid.message;
    expect(bid.slot).toEqual(slot);
    expect(bid.builderIndex).toEqual(builderIndex);
    expect(bid.parentBlockHash).toEqual(parentBlockHash);
    expect(bid.parentBlockRoot).toEqual(parentBlockRoot);
    expect(bid.prevRandao).toEqual(prevRandao);
    expect(bid.feeRecipient).toEqual(proposerFeeRecipient);
    expect(bid.gasLimit).toEqual(30_000_000n);
    expect(bid.executionPayment).toEqual(0n);
    // 90% of 1 ETH payload value
    expect(bid.value).toEqual(900_000_000);
    expect(bid.executionRequestsRoot).toEqual(
      ssz.gloas.ExecutionRequests.hashTreeRoot(ssz.gloas.ExecutionRequests.defaultValue())
    );

    const blockHash = toRootHex(bid.blockHash);
    expect(store.has(blockHash)).toBe(true);
    expect(ledger.hasSubmitted(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(true);
  });

  it("ignores repeated payload attributes for the same parent", async () => {
    bidder.onPayloadAttributes(payloadAttributesEvent());
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(source.prepare).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it("bids once per parent variant", async () => {
    const emptyParentBlockHash = Buffer.alloc(32, 6);
    source.getPayload.mockImplementation(async (_fork, handle) =>
      mockBuiltPayload({
        slot,
        parentHash: handle.payloadId === "0xfull" ? parentBlockHash : emptyParentBlockHash,
        blockHash: handle.payloadId === "0xfull" ? Buffer.alloc(32, 7) : Buffer.alloc(32, 8),
        prevRandao,
      })
    );
    source.prepare.mockImplementation(async (req) => ({
      sourceId: source.id,
      payloadId: req.forkchoiceState.headBlockHash === toRootHex(parentBlockHash) ? "0xfull" : "0xempty",
    }));

    bidder.onPayloadAttributes(payloadAttributesEvent());
    bidder.onPayloadAttributes(payloadAttributesEvent({parentBlockHash: emptyParentBlockHash}));
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(source.prepare).toHaveBeenCalledTimes(2);
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledTimes(2);
    const parentHashes = api.beacon.publishExecutionPayloadBid.mock.calls.map(([{signedExecutionPayloadBid}]) =>
      toRootHex(signedExecutionPayloadBid.message.parentBlockHash)
    );
    expect(parentHashes.sort()).toEqual([toRootHex(parentBlockHash), toRootHex(emptyParentBlockHash)].sort());
  });

  it("retries prepare until the execution client accepts the build", async () => {
    source.prepare.mockRejectedValueOnce(Error("Execution Layer Syncing"));
    source.prepare.mockRejectedValueOnce(Error("Execution Layer Syncing"));
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(source.prepare).toHaveBeenCalledTimes(3);
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it("does not bid if no build could be started before the deadline", async () => {
    source.prepare.mockRejectedValue(Error("Execution Layer Syncing"));
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(source.getPayload).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to start payload build before deadline",
      expect.anything(),
      expect.anything()
    );
  });

  it("bids on the most valuable payload across sources", async () => {
    const cheap = new FakePayloadSource("cheap");
    cheap.getPayload.mockResolvedValue(
      mockBuiltPayload({
        sourceId: "cheap",
        slot,
        parentHash: parentBlockHash,
        prevRandao,
        valueGwei: 1,
        blockHash: Buffer.alloc(32, 7),
      })
    );
    const rich = new FakePayloadSource("rich");
    rich.getPayload.mockResolvedValue(
      mockBuiltPayload({
        sourceId: "rich",
        slot,
        parentHash: parentBlockHash,
        prevRandao,
        valueGwei: 2_000_000_000,
        blockHash: Buffer.alloc(32, 8),
      })
    );
    bidder.close();
    bidder = createBidder([cheap, rich]);

    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    const bid = api.beacon.publishExecutionPayloadBid.mock.calls[0][0].signedExecutionPayloadBid.message;
    expect(bid.blockHash).toEqual(Buffer.alloc(32, 8));
    expect(bid.value).toEqual(1_800_000_000);
  });

  it("ignores a source that fails to return a payload", async () => {
    const broken = new FakePayloadSource("broken");
    broken.getPayload.mockRejectedValue(Error("unavailable"));
    bidder.close();
    bidder = createBidder([broken, source]);

    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it("does not bid without proposer preferences", async () => {
    preferences.prune(slot + 10);
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    expect(store.size).toEqual(0);
  });

  it("does not bid if the payload builds on an unexpected parent", async () => {
    source.getPayload.mockResolvedValue(mockBuiltPayload({slot, parentHash: Buffer.alloc(32, 9), prevRandao}));
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("does not bid if the builder is not active", async () => {
    builderStatus = {status: "pending", balance: balanceGwei};
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("does not bid below the operating balance", async () => {
    builderStatus = {status: "active", balance: opts.minOperatingBalanceGwei - 1};
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("does not bid more than the coverable balance", async () => {
    // Balance of 2.5 ETH covers 1.5 ETH above the minimum, payload is worth 2 ETH
    builderStatus = {status: "active", balance: 2.5 * MIN_DEPOSIT_AMOUNT};
    source.getPayload.mockResolvedValue(
      mockBuiltPayload({slot, parentHash: parentBlockHash, prevRandao, valueGwei: 2 * MIN_DEPOSIT_AMOUNT})
    );
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Bid policy declined to bid", expect.anything());
  });

  it("ignores payload attributes for past slots", async () => {
    clock.currentSlot = slot;
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(source.prepare).not.toHaveBeenCalled();
  });

  it("ignores pre-gloas payload attributes", async () => {
    bidder.onPayloadAttributes({...payloadAttributesEvent(), version: ForkName.fulu});
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(source.prepare).not.toHaveBeenCalled();
  });

  it("drops slot state once the slot has passed", async () => {
    bidder.onPayloadAttributes(payloadAttributesEvent());
    bidder.onSlot(slot);
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("records the bid even if publishing fails", async () => {
    api.beacon.publishExecutionPayloadBid.mockRejectedValue(Error("boom"));
    bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(deadlineMs);

    expect(ledger.hasSubmitted(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(true);
    expect(logger.error).toHaveBeenCalledWith("Error submitting bid", expect.anything(), expect.anything());
  });

  it("uses the payload attributes event type from the api", () => {
    const event: routes.events.EventData[routes.events.EventType.payloadAttributes] = payloadAttributesEvent();
    expect(event.version).toEqual(ForkName.gloas);
  });
});
