import {beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {ObservedBlock} from "../../../src/services/blockObserver.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {Revealer} from "../../../src/services/revealer.js";
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
    }));
  });

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

  it("rejects a selected bid of our builder that was not recorded", async () => {
    const observed = selectedBlock({recordBid: false});

    await expect(revealer.onBlock(observed)).rejects.toThrow();
    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });
});
