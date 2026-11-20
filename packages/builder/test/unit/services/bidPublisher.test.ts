import {describe, expect, it, vi} from "vitest";
import {HttpStatusCode} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey, Signature, verify} from "@lodestar/native/blst";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {getExecutionPayloadBidSigningRoot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {type BidIdentity, BidLedger, BidLedgerErrorCode} from "../../../src/services/bidLedger.js";
import {BidPublisher, BidPublisherError, BidPublisherErrorCode} from "../../../src/services/bidPublisher.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {CommitmentJournalError} from "../../../src/services/commitmentJournalError.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../utils/apiStub.js";
import {mockBuiltPayload} from "../utils/payload.js";

const builderIndex = 7;

describe("BidPublisher", () => {
  it("does not sign before the floor and rechecks it immediately before P2P handoff", async () => {
    let allowed = false;
    const retention = vi.fn();
    const {publisher, signer, api} = createPublisher({
      hasPayload: () => true,
      retainCommitment: retention,
      canSign: () => allowed,
    });
    const sign = vi.spyOn(signer, "signExecutionPayloadBid");
    await expect(publisher.prepare(createBid())).rejects.toThrow("ORDER_OFFER_TOO_EARLY");
    expect(sign).not.toHaveBeenCalled();
    expect(retention).not.toHaveBeenCalled();
    allowed = true;
    const signed = await publisher.prepare(createBid());
    allowed = false;
    await expect(publisher.gossip(signed, new AbortController().signal)).rejects.toThrow("ORDER_OFFER_TOO_EARLY");
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    expect(retention).toHaveBeenCalledOnce();
  });

  it("passes each immutable offer attribution through concurrent retention", async () => {
    const disk = defer<void>();
    const store = new PayloadStore();
    const firstId = `0x${"11".repeat(32)}`;
    const secondId = `0x${"22".repeat(32)}`;
    const payload = mockBuiltPayload({slot: 10});
    const original = {
      slot: 10,
      parentBlockRoot: Buffer.alloc(32),
      blockHash: toRootHex(payload.executionPayload.blockHash),
      payload: {...payload, orderMetadata: {version: 1 as const, orderIds: [firstId], doNotOfferBefore: 0}},
    };
    const first = store.add(original);
    const second = store.add({
      ...original,
      payload: {...original.payload, orderMetadata: {...original.payload.orderMetadata, orderIds: [secondId]}},
    });
    const retain = vi.fn(async (_bid, offered) => {
      await disk.promise;
      expect(offered?.payload.orderMetadata?.orderIds).toEqual(offered === first ? [firstId] : [secondId]);
    }) satisfies NonNullable<ConstructorParameters<typeof BidPublisher>[0]["retainCommitment"]>;
    const canSign = vi.fn((_identity, offered) => offered?.payload.orderMetadata?.doNotOfferBefore === 0);
    const {publisher} = createPublisher({hasPayload: () => true, retainCommitment: retain, canSign});
    const bid = createBid();
    const one = publisher.prepare(bid, 256, first);
    const two = publisher.prepare(bid, 256, second);
    expect(retain.mock.calls[0][1]).toBe(first);
    expect(retain.mock.calls[1][1]).toBe(second);
    expect(store.get(original.blockHash)?.payload.orderMetadata?.orderIds).toEqual([firstId]);
    disk.resolve();
    await Promise.all([one, two]);
  });

  it("requires context before signing on production publishers and forwards it through publish", async () => {
    const retain = vi.fn();
    const {publisher, signer} = createPublisher({
      hasPayload: () => true,
      retainCommitment: retain,
      requireOfferContext: true,
    });
    const sign = vi.spyOn(signer, "signExecutionPayloadBid");
    await expect(publisher.prepare(createBid())).rejects.toThrow("COMMITMENT_OFFER_MISSING");
    await expect(publisher.publish(createBid(), new AbortController().signal)).rejects.toThrow(
      "COMMITMENT_OFFER_MISSING"
    );
    expect(sign).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
    const payload = mockBuiltPayload();
    const offered = {
      slot: 10,
      parentBlockRoot: Buffer.alloc(32),
      blockHash: toRootHex(payload.executionPayload.blockHash),
      payload,
    };
    await publisher.publish(createBid(), new AbortController().signal, undefined, offered);
    expect(retain.mock.calls[0][1]).toBe(offered);
  });

  it("bounds repeated same-signature admissions independently of ledger deduplication", async () => {
    const {publisher, ledger, signer} = createPublisher({hasPayload: () => true});
    const sign = vi.spyOn(signer, "signExecutionPayloadBid");
    const bid = createBid();
    for (let i = 0; i < 4; i++) await publisher.prepare(bid, 4);
    expect(ledger.getRevisionCount(bid.slot)).toBe(1);
    await expect(publisher.prepare(bid, 4)).rejects.toMatchObject({type: {code: BidLedgerErrorCode.REVISION_LIMIT}});
    expect(sign).toHaveBeenCalledTimes(4);
  });

  it("reserves primary revision headroom across pending and uncertain alternate writes", async () => {
    const disk = defer<void>();
    const retainCommitment = vi.fn(() => disk.promise);
    const {publisher, ledger} = createPublisher({hasPayload: () => true, retainCommitment});
    const bid = createBid();
    const first = publisher.prepare(bid, 2);
    const second = publisher.prepare({...bid, value: 6}, 2);
    await expect(publisher.prepare({...bid, value: 7}, 2)).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.REVISION_LIMIT},
    });
    const pending = Promise.allSettled([first, second]);
    disk.reject(Error("durable acknowledgement lost"));
    await pending;
    expect(ledger.getRevisionCount(bid.slot)).toBe(0);
    await expect(publisher.prepare({...bid, value: 8}, 2)).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.REVISION_LIMIT},
    });
    retainCommitment.mockResolvedValue(undefined);
    await publisher.prepare({...bid, value: 9}, 4);
    expect(ledger.getRevisionCount(bid.slot)).toBe(1);
  });

  it("keeps a pending durable revision ineligible and reserves the concurrent gossip tuple", async () => {
    const disk = defer<void>();
    const {publisher, ledger, api, signer} = createPublisher({
      hasPayload: () => true,
      retainCommitment: () => disk.promise,
    });
    const bid = createBid();
    const result = publisher.publish(bid, new AbortController().signal);
    expect(publisher.hasPendingRevisions(bid.slot)).toBe(true);
    expect(publisher.hasPendingRevisions(bid.slot + 1)).toBe(false);
    expect(ledger.getBidsForSlot(bid.slot)).toHaveLength(0);
    await expect(
      publisher.gossip(signer.signExecutionPayloadBid(bid), new AbortController().signal)
    ).rejects.toMatchObject({
      type: {code: BidPublisherErrorCode.BID_NOT_PREPARED},
    });
    await expect(publisher.publish({...bid, value: 6}, new AbortController().signal)).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.DUPLICATE_BID},
    });
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    disk.resolve();
    await result;
    expect(publisher.hasPendingRevisions(bid.slot)).toBe(false);
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(ledger.getBidsForSlot(bid.slot)).toHaveLength(1);
  });

  it("does not publish a canceled preparation after its durable write finishes", async () => {
    const disk = defer<void>();
    const {publisher, api} = createPublisher({hasPayload: () => true, retainCommitment: () => disk.promise});
    const controller = new AbortController();
    const result = publisher.publish(createBid(), controller.signal);
    controller.abort();
    disk.resolve();
    await expect(result).rejects.toMatchObject({name: "AbortError"});
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("retains a signature but does not expose it after cancellation races durable storage", async () => {
    const disk = defer<void>();
    const {publisher, api, ledger} = createPublisher({hasPayload: () => true, retainCommitment: () => disk.promise});
    const lease = {
      generation: "0x0",
      ready: true,
      validUntil: performance.now() + 10000,
      validUntilUnixMs: Date.now() + 10000,
    };
    const result = publisher.publish(createBid(), new AbortController().signal, {generation: "0x0", lease});
    lease.generation = "0x1";
    disk.resolve();
    await expect(result).rejects.toThrow("BID_OFFER_INELIGIBLE");
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
    expect(ledger.getRevisionCount(createBid().slot)).toBe(1);
  });

  it("includes pending writes in the revision limit", async () => {
    const disk = defer<void>();
    const {publisher, ledger} = createPublisher({hasPayload: () => true, retainCommitment: () => disk.promise});
    const bid = createBid();
    for (let i = 0; i < 255; i++) {
      const root = Buffer.alloc(32);
      root.writeUInt32BE(i, 28);
      ledger.recordRevision({...bidIdentity(bid), signedBidRoot: toRootHex(root), valueGwei: i});
    }
    const pending = publisher.prepare(bid);
    await expect(publisher.prepare({...bid, value: 6})).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.REVISION_LIMIT},
    });
    disk.resolve();
    await pending;
    expect(ledger.getRevisionCount(bid.slot)).toBe(256);
  });
  it("does not expose a signature or gossip when durable retention fails", async () => {
    const {api, publisher} = createPublisher({
      hasPayload: () => true,
      retainCommitment: () => {
        throw Error("disk failed");
      },
    });
    await expect(publisher.prepare(createBid())).rejects.toThrow("disk failed");
    await expect(publisher.publish(createBid(), new AbortController().signal)).rejects.toThrow("disk failed");
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });
  it("keeps uncertain durable writes in the revision admission budget", async () => {
    const retainCommitment = vi.fn(async () => {
      throw Error("worker exited after write");
    });
    const {publisher, ledger} = createPublisher({hasPayload: () => true, retainCommitment});
    const bid = createBid();
    for (let i = 0; i < 255; i++) {
      const root = Buffer.alloc(32);
      root.writeUInt32BE(i, 28);
      ledger.recordRevision({...bidIdentity(bid), signedBidRoot: toRootHex(root), valueGwei: i});
    }
    await expect(publisher.prepare(bid)).rejects.toThrow("worker exited after write");
    expect(publisher.hasPendingRevisions(bid.slot)).toBe(true);
    await expect(publisher.prepare({...bid, value: 6})).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.REVISION_LIMIT},
    });
    expect(retainCommitment).toHaveBeenCalledOnce();
    expect(ledger.getRevisionCount(bid.slot)).toBe(255);
  });

  it("releases revision admission when a write was rejected before dispatch", async () => {
    const retainCommitment = vi
      .fn()
      .mockRejectedValueOnce(new CommitmentJournalError("COMMITMENT_WORKER_CAPACITY", false))
      .mockResolvedValue(undefined);
    const {publisher, ledger} = createPublisher({hasPayload: () => true, retainCommitment});
    const bid = createBid();
    for (let i = 0; i < 255; i++) {
      const root = Buffer.alloc(32);
      root.writeUInt32BE(i, 28);
      ledger.recordRevision({...bidIdentity(bid), signedBidRoot: toRootHex(root), valueGwei: i});
    }
    await expect(publisher.prepare(bid)).rejects.toThrow("COMMITMENT_WORKER_CAPACITY");
    expect(publisher.hasPendingRevisions(bid.slot)).toBe(false);
    await publisher.prepare(bid);
    expect(retainCommitment).toHaveBeenCalledTimes(2);
    expect(ledger.getRevisionCount(bid.slot)).toBe(256);
  });
  it("signs, records, and submits a bid with a retained payload", async () => {
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
    const signedBidRoot = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signedBid));
    expect(ledger.recordWin({...bidIdentity(bid), signedBidRoot}, toRootHex(Buffer.alloc(32, 8)))?.blockHash).toBe(
      blockHash
    );
  });

  it("signs all Heze bid fields under the Heze fork", async () => {
    const bid = ssz.heze.ExecutionPayloadBid.defaultValue();
    bid.slot = 10;
    bid.builderIndex = builderIndex;
    bid.parentBlockHash = Buffer.alloc(32, 2);
    bid.parentBlockRoot = Buffer.alloc(32, 3);
    bid.blockHash = Buffer.alloc(32, 4);
    bid.value = 5;
    bid.inclusionListBits.set(1, true);
    const {api, config, keys, ledger, publisher} = createPublisher({
      hasPayload: vi.fn(() => true),
      fork: ForkName.heze,
    });

    const signedBid = await publisher.publish(bid, new AbortController().signal);

    expect(signedBid.message.inclusionListBits.get(1)).toBe(true);
    const signature = Signature.fromBytes(signedBid.signature, true);
    expect(verify(getExecutionPayloadBidSigningRoot(config, bid), keys.publicKey, signature)).toBe(true);
    expect(ledger.getBidsForSlot(bid.slot)[0].signedBidRoot).toBe(
      toRootHex(ssz.heze.SignedExecutionPayloadBid.hashTreeRoot(signedBid))
    );
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledWith(
      {signedExecutionPayloadBid: signedBid},
      {signal: expect.any(AbortSignal)}
    );
    bid.inclusionListBits.set(1, false);
    expect(verify(getExecutionPayloadBidSigningRoot(config, bid), keys.publicKey, signature)).toBe(false);
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
        `Bid builder index does not match local builder index builderIndex=${builderIndex} bidBuilderIndex=${bid.builderIndex}`
      )
    );
    expect(ledger.getBidsForSlot(bid.slot)).toEqual([]);
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("rejects a bid whose payload is not retained", async () => {
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
    const {api, publisher, signer} = createPublisher({hasPayload: vi.fn(() => true)});
    const sign = vi.spyOn(signer, "signExecutionPayloadBid");
    const signal = new AbortController().signal;
    await publisher.publish(bid, signal);

    await expect(publisher.publish({...bid, value: bid.value + 1}, signal)).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.DUPLICATE_BID},
    });
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(sign).toHaveBeenCalledOnce();
  });

  it("reserves the tuple before publication completes", async () => {
    const {api, publisher, signer} = createPublisher({hasPayload: vi.fn(() => true)});
    const sign = vi.spyOn(signer, "signExecutionPayloadBid");
    const response = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadBid>>>();
    api.beacon.publishExecutionPayloadBid.mockReturnValue(response.promise);
    const bid = createBid();
    const signal = new AbortController().signal;
    const first = publisher.publish(bid, signal);

    await expect(publisher.publish({...bid, value: 6}, signal)).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.DUPLICATE_BID},
    });
    expect(sign).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    response.resolve(await mockApiResponse({data: undefined, meta: undefined}));
    await first;
  });

  it("does not reserve a bid if signing fails", async () => {
    const {api, ledger, publisher, signer} = createPublisher({hasPayload: vi.fn(() => true)});
    vi.spyOn(signer, "signExecutionPayloadBid").mockImplementationOnce(() => {
      throw Error("signing failed");
    });
    const bid = createBid();
    await expect(publisher.publish(bid, new AbortController().signal)).rejects.toThrow("signing failed");
    expect(ledger.getBidsForSlot(bid.slot)).toEqual([]);
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed", "accepted"])("does not resubmit a pruned %s publication", async (outcome) => {
    const {api, ledger, publisher, signer} = createPublisher({hasPayload: vi.fn(() => true)});
    const sign = vi.spyOn(signer, "signExecutionPayloadBid");
    const response = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadBid>>>();
    api.beacon.publishExecutionPayloadBid.mockReturnValue(response.promise);
    const bid = createBid();
    const signal = new AbortController().signal;
    const first = publisher.publish(bid, signal);
    const firstOutcome = first.catch(() => undefined);
    await vi.waitFor(() => expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce());
    if (outcome === "failed") response.reject(Error("connection lost after submission"));
    if (outcome === "accepted") response.resolve(mockApiResponse({}));
    if (outcome !== "pending") await firstOutcome;

    ledger.prune(bid.slot + 3 * SLOTS_PER_EPOCH + 1);
    const second = publisher.publish({...bid, value: bid.value + 1}, signal);
    const secondOutcome = expect(second).rejects.toMatchObject({type: {code: BidLedgerErrorCode.BID_TOO_OLD}});
    if (outcome === "pending") response.resolve(mockApiResponse({}));
    await firstOutcome;
    await secondOutcome;

    expect(sign).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
  });

  it("rejects pre-Gloas input before signing", async () => {
    const {api, publisher, signer} = createPublisher({hasPayload: vi.fn(() => true), fork: ForkName.fulu});
    const sign = vi.spyOn(signer, "signExecutionPayloadBid");
    await expect(publisher.publish(createBid(), new AbortController().signal)).rejects.toMatchObject({
      type: {code: BidPublisherErrorCode.PRE_GLOAS_BID},
    });
    expect(sign).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("retains the submission record when the Beacon Node rejects publication", async () => {
    const bid = createBid();
    const {api, ledger, publisher} = createPublisher({hasPayload: vi.fn(() => true)});
    api.beacon.publishExecutionPayloadBid.mockResolvedValue(await mockApiErrorResponse(HttpStatusCode.BAD_REQUEST));

    await expect(publisher.publish(bid, new AbortController().signal)).rejects.toThrowError(
      expect.objectContaining({status: HttpStatusCode.BAD_REQUEST})
    );
    expect(ledger.hasSubmitted(bid.slot, toRootHex(bid.parentBlockHash), toRootHex(bid.parentBlockRoot))).toBe(true);
  });
});

function createPublisher({
  hasPayload,
  fork = ForkName.gloas,
  retainCommitment,
  canSign,
  requireOfferContext,
}: {
  hasPayload: (identity: BidIdentity) => boolean;
  canSign?: ConstructorParameters<typeof BidPublisher>[0]["canSign"];
  fork?: ForkName;
  requireOfferContext?: boolean;
  retainCommitment?: ConstructorParameters<typeof BidPublisher>[0]["retainCommitment"];
}) {
  const config = createBeaconConfig(getConfig(fork), Buffer.alloc(32, 9));
  const keys = keypair(Buffer.alloc(32, 1));
  const signer = new BuilderSigner(config, keys);
  const api = getApiClientStub();
  Object.assign(api.beacon, {publishExecutionPayloadBid: vi.fn()});
  api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
  const ledger = new BidLedger();
  const publisher = new BidPublisher({
    api,
    config,
    signer,
    ledger,
    builderIndex,
    hasPayload,
    retainCommitment,
    canSign,
    requireOfferContext,
  });
  return {api, config, keys, ledger, publisher, signer};
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
