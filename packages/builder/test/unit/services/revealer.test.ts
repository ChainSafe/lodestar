import {beforeEach, describe, expect, it, vi} from "vitest";
import {ApiError} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, FetchError, TimeoutError, toRootHex} from "@lodestar/utils";
import {BidLedger, BidLedgerError, BidLedgerErrorCode, BidLedgerErrorType} from "../../../src/services/bidLedger.js";
import {ObservedBlock} from "../../../src/services/blockObserver.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {Revealer, isRetryableRevealError} from "../../../src/services/revealer.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../utils/apiStub.js";
import {createBiddingModules, getPayloadSourceStub} from "../utils/bidding.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockBuiltPayload} from "../utils/payload.js";

const slot = 10;
const builderIndex = 1;
const config = getConfig(ForkName.gloas);

describe("Revealer", () => {
  let api: ReturnType<typeof getApiClientStub>;
  let logger: ReturnType<typeof getMockedLogger>;
  let clock: ClockMock;
  let payloadStore: PayloadStore;
  let ledger: BidLedger;
  let revealer: Revealer;

  beforeEach(() => {
    api = getApiClientStub();
    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));
    logger = getMockedLogger();
    clock = new ClockMock();
    payloadStore = new PayloadStore();
    ({ledger, revealer} = createModules());
  });

  function createModules(requestTimeout?: number): ReturnType<typeof createBiddingModules> {
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
      proposerPreferencesTracker: new ProposerPreferencesTracker(),
      payloadStore,
      payloadSource: getPayloadSourceStub(),
      signal: new AbortController().signal,
      index: builderIndex,
      requestTimeout,
    });
  }

  /** Block that selected a bid for a payload, optionally recorded as our bid and retained */
  function selectedBlock({recordBid = true, retainPayload = true} = {}): ObservedBlock {
    const payload = mockBuiltPayload({slot});
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const signedBid = block.message.body.signedExecutionPayloadBid;
    signedBid.message.slot = slot;
    signedBid.message.builderIndex = builderIndex;
    signedBid.message.parentBlockHash = payload.executionPayload.parentHash;
    signedBid.message.parentBlockRoot = Buffer.alloc(32, 4);
    signedBid.message.blockHash = payload.executionPayload.blockHash;
    signedBid.message.value = 5;
    signedBid.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
    const blockHash = toRootHex(signedBid.message.blockHash);

    if (recordBid) {
      ledger.recordBid({
        signedBid,
        signedBidRoot: toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signedBid)),
      });
    }
    if (retainPayload) {
      payloadStore.add({slot, parentBlockRoot: signedBid.message.parentBlockRoot, blockHash, payload});
    }

    return {
      blockRoot: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
      slot,
      executionOptimistic: false,
      version: ForkName.gloas,
      block,
      signedBid,
    };
  }

  it("reveals the retained payload of a selected bid", async () => {
    const observed = selectedBlock();

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    const {signedEnvelopeOrContents} = api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][0];
    expect(signedEnvelopeOrContents).toMatchObject({
      signedExecutionPayloadEnvelope: {
        message: {
          builderIndex,
          beaconBlockRoot: config.getForkTypes(observed.slot).BeaconBlock.hashTreeRoot(observed.block.message),
          parentBeaconBlockRoot: observed.signedBid.message.parentBlockRoot,
          payload: {blockHash: observed.signedBid.message.blockHash},
        },
      },
      kzgProofs: [],
      blobs: [],
    });
    expect(ledger.hasPublishedReveal(observed.blockRoot)).toBe(true);
    expect(ledger.getUnsettledValueGwei(0)).toBe(5);
  });

  it("ignores a block that selected another builder", async () => {
    const observed = selectedBlock();
    observed.signedBid.message.builderIndex = builderIndex + 1;
    observed.blockRoot = toRootHex(config.getForkTypes(observed.slot).BeaconBlock.hashTreeRoot(observed.block.message));

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(ledger.getUnsettledValueGwei(0)).toBe(0);
  });

  it("records the win but cannot reveal a payload that is not retained", async () => {
    const observed = selectedBlock({retainPayload: false});

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(ledger.getUnsettledValueGwei(0)).toBe(5);
  });

  it("does not reveal after the cutoff", async () => {
    const observed = selectedBlock();
    vi.spyOn(clock, "msFromSlot").mockReturnValue(
      config.getSlotComponentDurationMs(ForkName.gloas, config.PAYLOAD_ATTESTATION_DUE_BPS) + 1
    );

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(ledger.hasRevealed(observed.blockRoot)).toBe(false);
    expect(ledger.getUnsettledValueGwei(0)).toBe(5);
  });

  it("retries a transient publish failure within the reveal window", async () => {
    const observed = selectedBlock();
    api.beacon.publishExecutionPayloadEnvelope
      .mockResolvedValueOnce(await mockApiErrorResponse(503))
      .mockResolvedValueOnce(mockApiResponse({}));

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(
      "Retrying execution payload reveal",
      expect.objectContaining({attempt: 2})
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(ledger.hasPublishedReveal(observed.blockRoot)).toBe(true);
  });

  it("retries a publish request that timed out", async () => {
    const observed = selectedBlock();
    api.beacon.publishExecutionPayloadEnvelope
      .mockRejectedValueOnce(new TimeoutError("request"))
      .mockResolvedValueOnce(mockApiResponse({}));

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledTimes(2);
    // Each request is limited to less than the reveal window, the default request timeout would use it up
    const cutoffMs = config.getSlotComponentDurationMs(ForkName.gloas, config.PAYLOAD_ATTESTATION_DUE_BPS);
    for (const [i, [, init]] of api.beacon.publishExecutionPayloadEnvelope.mock.calls.entries()) {
      expect(init?.timeoutMs, `publish call ${i}`).toBeLessThan(cutoffMs);
    }
    expect(ledger.hasPublishedReveal(observed.blockRoot)).toBe(true);
  });

  it.each([
    {requestTimeout: 500, attemptTimeout: 500},
    {requestTimeout: 10_000, attemptTimeout: 2000},
  ])(
    "limits a publish request to $attemptTimeout ms with a request timeout of $requestTimeout ms",
    async ({requestTimeout, attemptTimeout}) => {
      ({ledger, revealer} = createModules(requestTimeout));
      api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));

      await revealer.onBlock(selectedBlock());

      expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        expect.objectContaining({timeoutMs: attemptTimeout})
      );
    }
  );

  it("only retries failures that can resolve while the reveal window is open", () => {
    const fetchFailure = new FetchError(
      "http://127.0.0.1:9596",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9596"), {code: "ECONNREFUSED"}),
      })
    );
    const inputError = new FetchError(
      "invalid-url",
      new TypeError("Failed to parse URL from invalid-url", {
        cause: Object.assign(new Error("Invalid URL"), {input: "invalid-url", code: "ERR_INVALID_URL"}),
      })
    );
    const ledgerError = new BidLedgerError(
      {code: BidLedgerErrorCode.INVALID_BID_VALUE} as BidLedgerErrorType,
      "invalid bid value"
    );
    const route = "publishExecutionPayloadEnvelope";

    expect(isRetryableRevealError(new ApiError("unavailable", 503, route))).toBe(true);
    expect(isRetryableRevealError(new TimeoutError("request"))).toBe(true);
    expect(isRetryableRevealError(fetchFailure)).toBe(true);
    expect(isRetryableRevealError(new ApiError("bad request", 400, route))).toBe(false);
    expect(isRetryableRevealError(new ApiError("not found", 404, route))).toBe(false);
    expect(isRetryableRevealError(inputError)).toBe(false);
    expect(isRetryableRevealError(new ErrorAborted("request"))).toBe(false);
    expect(isRetryableRevealError(ledgerError)).toBe(false);
    expect(isRetryableRevealError(Error("decode failed"))).toBe(false);
  });

  it("does not retry a rejected envelope", async () => {
    const observed = selectedBlock();
    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(await mockApiErrorResponse(400));

    await expect(revealer.onBlock(observed)).rejects.toThrow();

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(ledger.hasPublishedReveal(observed.blockRoot)).toBe(false);
  });

  it("stops retrying once a reveal can no longer start before the cutoff", async () => {
    const observed = selectedBlock();
    const cutoffMs = config.getSlotComponentDurationMs(ForkName.gloas, config.PAYLOAD_ATTESTATION_DUE_BPS);
    // Within the window when the block arrives, at the cutoff after the first failed attempt
    vi.spyOn(clock, "msFromSlot").mockReturnValueOnce(0).mockReturnValue(cutoffMs);
    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(await mockApiErrorResponse(503));

    await expect(revealer.onBlock(observed)).rejects.toThrow();

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(ledger.hasPublishedReveal(observed.blockRoot)).toBe(false);
  });

  it("rejects a selected bid of our builder that was not recorded", async () => {
    const observed = selectedBlock({recordBid: false});

    await expect(revealer.onBlock(observed)).rejects.toThrow();
    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });
});
