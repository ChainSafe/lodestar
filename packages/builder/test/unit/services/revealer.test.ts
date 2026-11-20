import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {ObservedBlock} from "../../../src/services/blockObserver.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {CommitmentJournal} from "../../../src/services/commitmentJournal.js";
import {type OfferEligibility, isOfferEligible} from "../../../src/services/offerEligibility.js";
import {type OrderMetadata, parseOrderMetadata} from "../../../src/services/orderMetadata.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {Revealer, RevealerOptions} from "../../../src/services/revealer.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
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
    createRevealer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createRevealer(revealOptions?: Partial<RevealerOptions>): void {
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    ({ledger, revealer} = createBiddingModules({
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
      revealOptions,
    }));
  }

  /** Block that selected a bid for a payload, optionally recorded as our bid and retained */
  function selectedBlock({
    recordBid = true,
    retainPayload = true,
    orderMetadata,
    offerEligibility,
    parentHash,
    parentRoot = Buffer.alloc(32, 4),
  }: {
    recordBid?: boolean;
    retainPayload?: boolean;
    orderMetadata?: OrderMetadata;
    offerEligibility?: OfferEligibility;
    parentHash?: Uint8Array;
    parentRoot?: Uint8Array;
  } = {}): ObservedBlock {
    const payload = {...mockBuiltPayload({slot, parentHash}), orderMetadata, offerEligibility};
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const signedBid = block.message.body.signedExecutionPayloadBid;
    signedBid.message.slot = slot;
    signedBid.message.builderIndex = builderIndex;
    signedBid.message.parentBlockHash = payload.executionPayload.parentHash;
    signedBid.message.parentBlockRoot = parentRoot;
    signedBid.message.blockHash = payload.executionPayload.blockHash;
    signedBid.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
    const blockHash = toRootHex(signedBid.message.blockHash);

    if (recordBid) {
      ledger.recordBid({
        slot,
        parentBlockHash: toRootHex(signedBid.message.parentBlockHash),
        parentBlockRoot: toRootHex(signedBid.message.parentBlockRoot),
        blockHash,
        valueGwei: 5,
        signedBidRoot: toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signedBid)),
      });
    }
    if (retainPayload) {
      payloadStore.add({slot, parentBlockRoot: signedBid.message.parentBlockRoot, blockHash, payload});
    }

    return {
      blockRoot: toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message)),
      slot,
      executionOptimistic: false,
      version: ForkName.gloas,
      block,
      signedBid,
    };
  }

  it.each([
    {branch: "FULL", parentHash: Buffer.alloc(32, 10), parentRoot: Buffer.alloc(32, 4)},
    {branch: "EMPTY", parentHash: Buffer.alloc(32, 9), parentRoot: Buffer.alloc(32, 4)},
    {branch: "parent", parentHash: Buffer.alloc(32, 9), parentRoot: Buffer.alloc(32, 3)},
  ])("reveals the exact old $branch payload selected after cancellation", async ({parentHash, parentRoot}) => {
    const orderId = `0x${"12".repeat(32)}`;
    const lease = {
      generation: "0x0",
      ready: true,
      validUntil: performance.now() + 10000,
      validUntilUnixMs: Date.now() + 10000,
    };
    const eligibility = {generation: "0x0", lease};
    const observed = selectedBlock({
      parentHash,
      parentRoot,
      orderMetadata: parseOrderMetadata({version: 1, orderIds: [orderId], doNotOfferBefore: 0}),
      offerEligibility: eligibility,
    });
    const stored = payloadStore.get(toRootHex(observed.signedBid.message.blockHash));
    if (!stored) throw Error("Missing exact old payload");
    const expected = ssz.gloas.ExecutionPayload.serialize(stored.payload.executionPayload);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cancelled-reveal-"));
    try {
      const journal = new CommitmentJournal(directory, {
        genesisValidatorsRoot: toRootHex(Buffer.alloc(32)),
        pubkey: "test",
      });
      journal.retain(observed.signedBid, stored);
      lease.generation = "0x1";
      const fenceAcknowledgedAt = Date.now();
      expect(isOfferEligible(eligibility)).toBe(false);
      expect(journal.queryExposure(orderId, fenceAcknowledgedAt)).toMatchObject({commitmentCount: 1});
      await revealer.onBlock(observed);
      const submitted = api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][0].signedEnvelopeOrContents;
      expect("signedExecutionPayloadEnvelope" in submitted).toBe(true);
      if (!("signedExecutionPayloadEnvelope" in submitted)) throw Error("Missing revealed contents");
      expect(ssz.gloas.ExecutionPayload.serialize(submitted.signedExecutionPayloadEnvelope.message.payload)).toEqual(
        expected
      );
      expect(ledger.hasPublishedReveal(observed.blockRoot)).toBe(true);
      expect(journal.queryExposure(orderId, fenceAcknowledgedAt).commitmentCount).toBe(1);
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });

  it("reveals the retained payload of a selected bid", async () => {
    const observed = selectedBlock();

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    const {signedEnvelopeOrContents} = api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][0];
    expect(signedEnvelopeOrContents).toMatchObject({
      signedExecutionPayloadEnvelope: {
        message: {
          builderIndex,
          beaconBlockRoot: config.getForkTypes(slot).BeaconBlock.hashTreeRoot(observed.block.message),
          parentBeaconBlockRoot: observed.signedBid.message.parentBlockRoot,
          payload: {blockHash: observed.signedBid.message.blockHash},
        },
      },
      kzgProofs: [],
      blobs: [],
    });
    expect(ledger.hasPublishedReveal(observed.blockRoot)).toBe(true);
    expect(ledger.getUnsettledValueGwei(0)).toBe(5);
    expect(logger.info).toHaveBeenCalledWith("Execution payload bid selected", expect.objectContaining({slot}));
  });

  it("reveals either retained revision after a higher API bid has been prepared", async () => {
    const first = selectedBlock();
    const block = structuredClone(first.block);
    const signedBid = block.message.body.signedExecutionPayloadBid;
    signedBid.message.blockHash = Buffer.alloc(32, 17);
    signedBid.message.value = 20;
    const blockHash = toRootHex(signedBid.message.blockHash);
    const old = payloadStore.get(toRootHex(first.signedBid.message.blockHash));
    if (!old) throw Error("Expected retained first payload");
    payloadStore.add({
      ...old,
      blockHash,
      payload: {
        ...old.payload,
        executionPayload: {...old.payload.executionPayload, blockHash: signedBid.message.blockHash},
      },
    });
    ledger.recordRevision({
      slot,
      parentBlockHash: toRootHex(signedBid.message.parentBlockHash),
      parentBlockRoot: toRootHex(signedBid.message.parentBlockRoot),
      blockHash,
      valueGwei: 20,
      signedBidRoot: toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signedBid)),
    });
    const second = {
      ...first,
      block,
      signedBid,
      blockRoot: toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message)),
    };
    await revealer.onBlock(first);
    await revealer.onBlock(second);
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledTimes(2);
    for (const [index, expected] of [first, second].entries()) {
      expect(api.beacon.publishExecutionPayloadEnvelope.mock.calls[index][0].signedEnvelopeOrContents).toMatchObject({
        signedExecutionPayloadEnvelope: {message: {payload: {blockHash: expected.signedBid.message.blockHash}}},
      });
    }
    expect(ledger.getUnsettledValueGwei(0)).toBe(20);
  });

  it("ignores a block that selected another builder", async () => {
    const observed = selectedBlock();
    observed.signedBid.message.builderIndex = builderIndex + 1;
    observed.blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(observed.block.message));

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(ledger.getUnsettledValueGwei(0)).toBe(0);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      "Execution payload bid not selected",
      expect.objectContaining({slot, selectedBuilderIndex: builderIndex + 1})
    );
  });

  it("does not log a block of a slot it did not bid on", async () => {
    const observed = selectedBlock({recordBid: false});
    observed.signedBid.message.builderIndex = builderIndex + 1;
    observed.blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(observed.block.message));

    await revealer.onBlock(observed);

    expect(logger.info).not.toHaveBeenCalled();
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

  it("withholds the payload of a selected bid", async () => {
    createRevealer({adversarialWithholdExecutionPayload: true});
    const observed = selectedBlock();

    await revealer.onBlock(observed);

    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(ledger.hasRevealed(observed.blockRoot)).toBe(false);
    expect(ledger.getUnsettledValueGwei(0)).toBe(5);
  });

  it("delays the reveal until the configured point in the slot", async () => {
    vi.useFakeTimers();
    createRevealer({adversarialDelayExecutionPayload: true, adversarialDelayExecutionPayloadBps: 8000});
    const observed = selectedBlock();

    const revealing = revealer.onBlock(observed);
    await vi.advanceTimersByTimeAsync(config.getSlotComponentDurationMs(ForkName.gloas, 8000) - 1);
    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await revealing;
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(ledger.hasPublishedReveal(observed.blockRoot)).toBe(true);
  });

  it("rejects a selected bid of our builder that was not recorded", async () => {
    const observed = selectedBlock({recordBid: false});

    await expect(revealer.onBlock(observed)).rejects.toThrow();
    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });
});
