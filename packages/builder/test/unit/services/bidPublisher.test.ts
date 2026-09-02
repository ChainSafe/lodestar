import {describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {HttpStatusCode} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {type BidIdentity, BidLedger, BidLedgerErrorCode} from "../../../src/services/bidLedger.js";
import {BidPublisher, BidPublisherError, BidPublisherErrorCode} from "../../../src/services/bidPublisher.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../utils/apiStub.js";

const builderIndex = 7;
const signer = new BuilderSigner(
  createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 9)),
  keypair(Buffer.alloc(32, 1))
);

describe("BidPublisher", () => {
  it("signs, records, and submits a bid with retained payload material", async () => {
    const bid = createBid();
    const blockHash = toRootHex(bid.blockHash);
    const hasPayload = vi.fn(() => true);
    const {api, ledger, publisher} = createPublisher({hasPayload});

    const signedBid = await publisher.publish(bid, new AbortController().signal);

    expect(signedBid.message).toBe(bid);
    expect(hasPayload).toHaveBeenCalledWith(bidIdentity(bid));
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledWith(
      {signedExecutionPayloadBid: signedBid},
      {signal: expect.any(AbortSignal)}
    );
    expect(ledger.recordWin(bidIdentity(bid), toRootHex(Buffer.alloc(32, 8)))?.blockHash).toBe(blockHash);
  });

  it("rejects a bid for another Builder before signing or recording", async () => {
    const bid = createBid();
    bid.builderIndex++;
    const {api, ledger, publisher} = createPublisher({hasPayload: vi.fn(() => true)});

    await expect(publisher.publish(bid, new AbortController().signal)).rejects.toThrowError(
      new BidPublisherError(
        {
          code: BidPublisherErrorCode.BUILDER_INDEX_MISMATCH,
          builderIndex,
          bidBuilderIndex: bid.builderIndex,
        },
        `Bid Builder index does not match local Builder index builderIndex=${builderIndex} bidBuilderIndex=${bid.builderIndex}`
      )
    );
    expect(ledger.getBidsForSlot(bid.slot)).toEqual([]);
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("rejects a bid whose reveal material is not retained", async () => {
    const bid = createBid();
    const identity = bidIdentity(bid);
    const {api, ledger, publisher} = createPublisher({hasPayload: vi.fn(() => false)});

    await expect(publisher.publish(bid, new AbortController().signal)).rejects.toThrowError(
      new BidPublisherError(
        {code: BidPublisherErrorCode.PAYLOAD_NOT_RETAINED, ...identity},
        `Bid payload is not retained slot=${identity.slot} parentBlockHash=${identity.parentBlockHash} parentBlockRoot=${identity.parentBlockRoot} blockHash=${identity.blockHash}`
      )
    );
    expect(ledger.getBidsForSlot(bid.slot)).toEqual([]);
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("rejects an already aborted call without side effects", async () => {
    const controller = new AbortController();
    controller.abort();
    const hasPayload = vi.fn(() => true);
    const {api, ledger, publisher} = createPublisher({hasPayload});
    const bid = createBid();

    await expect(publisher.publish(bid, controller.signal)).rejects.toMatchObject({name: "AbortError"});
    expect(hasPayload).not.toHaveBeenCalled();
    expect(ledger.getBidsForSlot(bid.slot)).toEqual([]);
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("enforces one submission for the same parent tuple", async () => {
    const bid = createBid();
    const {api, publisher} = createPublisher({hasPayload: vi.fn(() => true)});
    const signal = new AbortController().signal;
    await publisher.publish(bid, signal);

    await expect(publisher.publish(bid, signal)).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.DUPLICATE_BID},
    });
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it("keeps the one-shot record when the Beacon Node rejects publication", async () => {
    const bid = createBid();
    const {api, ledger, publisher} = createPublisher({hasPayload: vi.fn(() => true)});
    api.beacon.publishExecutionPayloadBid.mockResolvedValue(await mockApiErrorResponse(HttpStatusCode.BAD_REQUEST));

    await expect(publisher.publish(bid, new AbortController().signal)).rejects.toThrow();
    expect(ledger.hasSubmitted(bid.slot, toRootHex(bid.parentBlockHash), toRootHex(bid.parentBlockRoot))).toBe(true);
  });
});

function createPublisher({hasPayload}: {hasPayload: (identity: BidIdentity) => boolean}) {
  const api = getApiClientStub();
  Object.assign(api.beacon, {publishExecutionPayloadBid: vi.fn()});
  api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
  const ledger = new BidLedger();
  const publisher = new BidPublisher({api, signer, ledger, builderIndex, hasPayload});
  return {api, ledger, publisher};
}

function createBid(): ReturnType<typeof ssz.gloas.ExecutionPayloadBid.defaultValue> {
  const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
  bid.slot = 10;
  bid.builderIndex = builderIndex;
  bid.parentBlockHash = Buffer.alloc(32, 2);
  bid.parentBlockRoot = Buffer.alloc(32, 3);
  bid.blockHash = Buffer.alloc(32, 4);
  bid.value = 5;
  return bid;
}

function bidIdentity(bid: ReturnType<typeof createBid>) {
  return {
    slot: bid.slot,
    parentBlockHash: toRootHex(bid.parentBlockHash),
    parentBlockRoot: toRootHex(bid.parentBlockRoot),
    blockHash: toRootHex(bid.blockHash),
  };
}

function keypair(secretKeyBytes: Uint8Array) {
  const secretKey = SecretKey.fromBytes(secretKeyBytes);
  return {secretKey, publicKey: secretKey.toPublicKey()};
}
