import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {BuilderStatus, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {Bidder, MAX_PENDING_PAYLOAD_ATTRIBUTES, PayloadAttributesEvent} from "../../../src/services/bidder.js";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {HeadTracker} from "../../../src/services/headTracker.js";
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
  let headTracker: HeadTracker;
  let clock: ClockMock;
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
    headTracker = new HeadTracker();
    clock = new ClockMock();
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  function createBidder(getBuilderStatus?: () => {status: BuilderStatus | undefined; balance: number | undefined}): {
    bidder: Bidder;
    ledger: BidLedger;
  } {
    const config = getConfig(ForkName.gloas);
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    return createBiddingModules({
      api,
      config,
      logger,
      clock,
      builderSigner: new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), {
        secretKey,
        publicKey: secretKey.toPublicKey(),
      }),
      proposerPreferencesTracker,
      headTracker,
      payloadStore,
      payloadSource,
      signal: controller.signal,
      index: builderIndex,
      getBuilderStatus,
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

  function payloadAttributesEvent(parent = {root: parentBlockRoot, hash: parentBlockHash}): PayloadAttributesEvent {
    const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
    data.proposalSlot = slot;
    data.parentBlockRoot = parent.root;
    data.parentBlockHash = parent.hash;
    data.safeBlockHash = Buffer.alloc(32, 2);
    data.finalizedBlockHash = Buffer.alloc(32, 3);
    data.payloadAttributes.prevRandao = prevRandao;
    data.payloadAttributes.targetGasLimit = 30_000_000n;
    return {version: ForkName.gloas, data};
  }

  it("builds on the emitted parent and publishes a bid at the deadline", async () => {
    addProposerPreferences();
    const {bidder, ledger} = createBidder();

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
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("takes the dependent root from the tracked parent head instead of fetching proposer duties", async () => {
    addProposerPreferences();
    headTracker.onHead({
      slot: 0,
      block: toRootHex(parentBlockRoot),
      state: toRootHex(Buffer.alloc(32, 1)),
      payloadStatus: "full",
      epochTransition: false,
      currentEpochDependentRoot: dependentRoot,
      nextEpochDependentRoot: toRootHex(Buffer.alloc(32, 8)),
      executionOptimistic: false,
    });
    const {bidder} = createBidder();

    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await bidding;

    expect(api.validator.getProposerDutiesV2).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it("bids once for repeated payload attributes of the same parent", async () => {
    addProposerPreferences();
    const {bidder} = createBidder();

    const first = bidder.onPayloadAttributes(payloadAttributesEvent());
    const duplicate = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await Promise.all([first, duplicate]);
    await bidder.onPayloadAttributes(payloadAttributesEvent());

    expect(payloadSource.prepare).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not build without proposer preferences", async () => {
    const {bidder} = createBidder();

    await bidder.onPayloadAttributes(payloadAttributesEvent());

    expect(payloadSource.prepare).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  describe("proposer preferences received after the payload attributes", () => {
    const missingPreferences = "No proposer preferences known for slot, not bidding";

    it("bids once the proposer preferences of the slot are known", async () => {
      const {bidder} = createBidder();
      await bidder.onPayloadAttributes(payloadAttributesEvent());

      addProposerPreferences();
      const bidding = bidder.onProposerPreferences(slot);
      await vi.advanceTimersByTimeAsync(msToDeadline);
      await bidding;

      expect(payloadSource.prepare).toHaveBeenCalledOnce();
      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();

      // Not bid on again
      await bidder.onProposerPreferences(slot);
      expect(payloadSource.prepare).toHaveBeenCalledOnce();
    });

    it("bids if preferences of several slots were added", async () => {
      const {bidder} = createBidder();
      await bidder.onPayloadAttributes(payloadAttributesEvent());

      addProposerPreferences();
      const bidding = bidder.onProposerPreferences();
      await vi.advanceTimersByTimeAsync(msToDeadline);
      await bidding;

      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    });

    it("keeps waiting for the proposer preferences of the slot", async () => {
      const {bidder} = createBidder();
      await bidder.onPayloadAttributes(payloadAttributesEvent());

      // Preferences of another slot, and of the slot but for another dependent root
      await bidder.onProposerPreferences(slot + 1);
      await bidder.onProposerPreferences(slot);
      await bidder.onProposerPreferences();

      expect(payloadSource.prepare).not.toHaveBeenCalled();
      // Reported once, not every time other proposer preferences are received
      expect(logger.debug.mock.calls.filter(([message]) => message === missingPreferences)).toHaveLength(1);

      addProposerPreferences();
      const bidding = bidder.onProposerPreferences(slot);
      await vi.advanceTimersByTimeAsync(msToDeadline);
      await bidding;
      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    });

    it("keeps the latest payload attributes if too many are waiting", async () => {
      const {bidder} = createBidder();
      // One more parent than can be kept, the first one is dropped
      const parents = Array.from({length: MAX_PENDING_PAYLOAD_ATTRIBUTES + 1}, (_, i) => ({
        root: Buffer.alloc(32, 100 + i),
        hash: Buffer.alloc(32, 150 + i),
      }));
      for (const parent of parents) {
        await bidder.onPayloadAttributes(payloadAttributesEvent(parent));
      }

      addProposerPreferences();
      const bidding = bidder.onProposerPreferences(slot);
      await vi.advanceTimersByTimeAsync(msToDeadline);
      await bidding;

      const builtOn = payloadSource.prepare.mock.calls.map(([request]) => request.forkchoiceState.headBlockHash);
      expect(builtOn).toEqual(parents.slice(1).map(({hash}) => toRootHex(hash)));
    });

    it("does not resolve the dependent root of the parent again", async () => {
      const {bidder} = createBidder();
      // The parent is not a tracked head, its dependent root is taken from the proposer duties
      await bidder.onPayloadAttributes(payloadAttributesEvent());
      expect(api.validator.getProposerDutiesV2).toHaveBeenCalledOnce();

      // The head of the beacon node is on another branch by the time the proposer preferences are received
      api.validator.getProposerDutiesV2.mockResolvedValue(
        mockApiResponse({data: [], meta: {executionOptimistic: false, dependentRoot: toRootHex(Buffer.alloc(32, 8))}})
      );
      addProposerPreferences();
      const bidding = bidder.onProposerPreferences(slot);
      await vi.advanceTimersByTimeAsync(msToDeadline);
      await bidding;

      expect(api.validator.getProposerDutiesV2).toHaveBeenCalledOnce();
      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    });

    it("does not bid once the bid deadline has passed", async () => {
      const {bidder} = createBidder();
      await bidder.onPayloadAttributes(payloadAttributesEvent());

      // Before the slot, the deadline is reached with the remaining time to the slot
      const msToSlot = clock.msToSlot(slot);
      vi.spyOn(clock, "msToSlot").mockReturnValue(msToSlot - msToDeadline);
      addProposerPreferences();
      await bidder.onProposerPreferences(slot);

      expect(payloadSource.prepare).not.toHaveBeenCalled();
      // Not a failed bid
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("does not bid once the slot started", async () => {
      const {bidder} = createBidder();
      await bidder.onPayloadAttributes(payloadAttributesEvent());

      clock.currentSlot = slot;
      addProposerPreferences();
      await bidder.onProposerPreferences(slot);

      expect(payloadSource.prepare).not.toHaveBeenCalled();
    });
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

  it("does not bid while the beacon node head is optimistic", async () => {
    addProposerPreferences();
    headTracker.onHead({
      slot: 0,
      block: toRootHex(parentBlockRoot),
      state: toRootHex(Buffer.alloc(32, 1)),
      payloadStatus: "full",
      epochTransition: false,
      currentEpochDependentRoot: dependentRoot,
      nextEpochDependentRoot: toRootHex(Buffer.alloc(32, 8)),
      executionOptimistic: true,
    });
    const {bidder, ledger} = createBidder();

    const bidding = bidder.onPayloadAttributes(payloadAttributesEvent());
    await vi.advanceTimersByTimeAsync(msToDeadline);
    await bidding;

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
