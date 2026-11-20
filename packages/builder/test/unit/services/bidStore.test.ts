import {afterEach, describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidStore} from "../../../src/services/bidStore.js";
import type {OfferLease} from "../../../src/services/offerEligibility.js";

const parentBlockHash = Buffer.alloc(32, 1);
const parentBlockRoot = Buffer.alloc(32, 2);

function signedBid(slot: number, parentHash = parentBlockHash) {
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  bid.message.slot = slot;
  bid.message.parentBlockHash = parentHash;
  bid.message.parentBlockRoot = parentBlockRoot;
  return bid;
}

describe("BidStore", () => {
  it("copies current admission membership without mutating an earlier owner's wrapper", () => {
    const store = new BidStore();
    const bid = signedBid(5);
    const oldId = `0x${"11".repeat(32)}`;
    const newId = `0x${"22".repeat(32)}`;
    const oldIds = [oldId];
    store.add(bid, undefined, {version: 1, orderIds: oldIds, doNotOfferBefore: 0});
    const previous = store.getOfferOrderMetadata(bid);
    oldIds[0] = newId;
    expect(previous?.orderIds).toEqual([oldId]);
    expect(Object.isFrozen(previous?.orderIds)).toBe(true);
    store.add(bid, undefined, {version: 1, orderIds: [newId], doNotOfferBefore: 0});
    expect(store.getOfferOrderMetadata(bid)?.orderIds).toEqual([newId]);
    expect(previous?.orderIds).toEqual([oldId]);
    store.prune(8);
    expect(store.getOfferOrderMetadata(bid)).toBeUndefined();
  });

  it("does not borrow earlier membership for an unknown current admission", () => {
    const store = new BidStore();
    const bid = signedBid(5);
    store.add(bid, undefined, {version: 1, orderIds: [`0x${"11".repeat(32)}`], doNotOfferBefore: 0});
    store.add(bid);
    expect(store.getOfferOrderMetadata(bid)).toBeUndefined();
    store.add(bid, undefined, {version: 1, orderIds: null, doNotOfferBefore: 0});
    expect(store.getOfferOrderMetadata(bid)?.orderIds).toBeNull();
  });

  it("keeps membership paired with its existing lease on an unqualified duplicate", () => {
    const store = new BidStore();
    const bid = signedBid(5);
    const lease = {generation: "0x1", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity};
    const id = `0x${"22".repeat(32)}`;
    store.add(bid, {generation: "0x1", lease}, {version: 1, orderIds: [id], doNotOfferBefore: 0});
    store.add(bid);
    expect(store.getOfferOrderMetadata(bid)?.orderIds).toEqual([id]);
    expect(store.getOfferEligibility(bid)?.lease).toBe(lease);
  });

  it("validates admission metadata before changing the store", () => {
    const store = new BidStore();
    const bid = signedBid(5);
    expect(() => store.add(bid, undefined, {version: 1, orderIds: ["bad"], doNotOfferBefore: 0})).toThrow(
      "ORDER_METADATA_INVALID"
    );
    expect(store.has(bid)).toBe(false);
    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBeNull();
  });
  it("returns the bid of a slot and parent", () => {
    const store = new BidStore();
    const bid = signedBid(5);
    store.add(bid);

    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(bid);
    expect(store.get(6, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBeNull();
    expect(store.get(5, toRootHex(Buffer.alloc(32, 9)), toRootHex(parentBlockRoot))).toBeNull();
    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(Buffer.alloc(32, 9)))).toBeNull();
  });

  it("keeps bids on different parents of the same slot", () => {
    const store = new BidStore();
    const otherParentHash = Buffer.alloc(32, 3);
    const bid = signedBid(5);
    const otherBid = signedBid(5, otherParentHash);
    store.add(bid);
    store.add(otherBid);

    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(bid);
    expect(store.get(5, toRootHex(otherParentHash), toRootHex(parentBlockRoot))).toBe(otherBid);
  });

  it("notifies only the subscribed context after the bid is retained", () => {
    const store = new BidStore();
    const bid = signedBid(5);
    const notify = vi.fn(() => {
      expect(store.has(bid)).toBe(true);
      expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(bid);
    });
    const unsubscribe = store.subscribe(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot), notify);
    store.add(signedBid(6));
    store.add(signedBid(5, Buffer.alloc(32, 9)));
    const otherRoot = signedBid(5);
    otherRoot.message.parentBlockRoot = Buffer.alloc(32, 9);
    store.add(otherRoot);
    expect(notify).not.toHaveBeenCalled();
    store.add(bid);
    expect(notify).toHaveBeenCalledOnce();
    unsubscribe();
    unsubscribe();
    store.add(bid);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not let a stale unsubscribe remove a newer subscription for the same context", () => {
    const store = new BidStore();
    const first = store.subscribe(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot), () => {});
    first();
    const notify = vi.fn();
    const second = store.subscribe(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot), notify);
    first();
    store.add(signedBid(5));
    expect(notify).toHaveBeenCalledOnce();
    second();
  });

  it("does not let a broken stream subscriber prevent durable bid publication", () => {
    const store = new BidStore();
    const broken = vi.fn(() => {
      throw Error("closed stream");
    });
    const healthy = vi.fn();
    store.subscribe(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot), broken);
    store.subscribe(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot), healthy);
    const bid = signedBid(5);
    expect(() => store.add(bid)).not.toThrow();
    expect(store.has(bid)).toBe(true);
    expect(healthy).toHaveBeenCalledOnce();
    store.add(bid);
    expect(broken).toHaveBeenCalledOnce();
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it("prunes bids two slots after their slot", () => {
    const store = new BidStore();
    store.add(signedBid(5));

    store.prune(7);
    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).not.toBeNull();

    store.prune(8);
    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBeNull();
  });
});

describe("offer generations", () => {
  afterEach(() => vi.restoreAllMocks());

  it("withdraws a cancelled generation but retains its signed reveal commitment", () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const store = new BidStore();
    const lease: OfferLease = {generation: "0x0", validUntil: 350, validUntilUnixMs: Infinity, ready: true};
    const old = signedBid(5);
    old.message.value = 100;
    store.add(old, {generation: "0x0", lease});
    expect(store.canOffer(old)).toBe(true);
    lease.generation = "0x1";
    lease.ready = false;
    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBeNull();
    expect(store.has(old)).toBe(true);
    const replacement = signedBid(5);
    replacement.message.value = 10;
    replacement.message.blockHash = Buffer.alloc(32, 8);
    lease.ready = true;
    store.add(replacement, {generation: "0x1", lease});
    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(replacement);
    expect(store.canOffer(old)).toBe(false);
    expect(store.has(old)).toBe(true);
    // A slow stale signing/retention completion must not displace the new bid.
    store.add(old, {generation: "0x0", lease});
    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBe(replacement);
  });

  it("expires offers on a stopped constructor and allows only a current heartbeat to renew", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    const store = new BidStore();
    const lease: OfferLease = {generation: "0x0", validUntil: 350, validUntilUnixMs: Infinity, ready: true};
    const bid = signedBid(5);
    store.add(bid, {generation: "0x0", lease});
    now.mockReturnValue(350);
    expect(store.canOffer(bid)).toBe(false);
    expect(store.has(bid)).toBe(true);
    lease.validUntil = 600;
    expect(store.canOffer(bid)).toBe(true);
    lease.generation = "0x1";
    expect(store.canOffer(bid)).toBe(false);
    store.prune(8);
    expect(store.has(bid)).toBe(false);
  });

  it("recovers reveal obligations without restoring volatile offer permission", () => {
    const store = new BidStore();
    const bid = signedBid(5);
    store.add(bid, "recovery");
    expect(store.has(bid)).toBe(true);
    expect(store.canOffer(bid)).toBe(false);
    expect(store.get(5, toRootHex(parentBlockHash), toRootHex(parentBlockRoot))).toBeNull();
    store.add(bid);
    expect(store.canOffer(bid)).toBe(true);
  });

  it("expires across host suspend even if the monotonic clock does not advance", () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const wall = vi.spyOn(Date, "now").mockReturnValue(1000);
    const store = new BidStore();
    const lease: OfferLease = {generation: "0x0", validUntil: 350, validUntilUnixMs: 1250, ready: true};
    const bid = signedBid(5);
    store.add(bid, {generation: "0x0", lease});
    expect(store.canOffer(bid)).toBe(true);
    wall.mockReturnValue(1300);
    expect(store.canOffer(bid)).toBe(false);
    expect(store.has(bid)).toBe(true);
  });
});
