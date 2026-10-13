import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {BuilderStatus, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {Bidder, PayloadAttributesEvent} from "../../../src/services/bidder.js";
import {BidLedger} from "../../../src/services/bidLedger.js";
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
