import {describe, beforeEach, expect, it} from "vitest";
import {SeenExecutionPayloadBids} from "../../../../src/chain/seenCache/seenExecutionPayloadBids.js";

describe("SeenExecutionPayloadBids", () => {
  const slot = 100;
  const builderIndex = 1;
  const parentBlockHash = "0xaa";
  const parentBlockRoot = "0xbb";

  let cache: SeenExecutionPayloadBids;

  beforeEach(() => {
    cache = new SeenExecutionPayloadBids();
  });

  it("should track bids per (slot, builder, parent_block_hash, parent_block_root)", () => {
    expect(cache.isKnown(slot, builderIndex, parentBlockHash, parentBlockRoot)).toBe(false);

    cache.add(slot, builderIndex, parentBlockHash, parentBlockRoot);
    expect(cache.isKnown(slot, builderIndex, parentBlockHash, parentBlockRoot)).toBe(true);

    // Same builder and slot but different tuple is not known
    expect(cache.isKnown(slot, builderIndex, "0xcc", parentBlockRoot)).toBe(false);
    expect(cache.isKnown(slot, builderIndex, parentBlockHash, "0xcc")).toBe(false);
    // Same tuple but different builder or slot is not known
    expect(cache.isKnown(slot, builderIndex + 1, parentBlockHash, parentBlockRoot)).toBe(false);
    expect(cache.isKnown(slot + 1, builderIndex, parentBlockHash, parentBlockRoot)).toBe(false);
  });

  it("should count seen bids per builder and slot", () => {
    expect(cache.seenCount(slot, builderIndex)).toBe(0);

    cache.add(slot, builderIndex, parentBlockHash, parentBlockRoot);
    cache.add(slot, builderIndex, "0xcc", parentBlockRoot);
    expect(cache.seenCount(slot, builderIndex)).toBe(2);

    // Adding the same tuple again does not increase the count
    cache.add(slot, builderIndex, parentBlockHash, parentBlockRoot);
    expect(cache.seenCount(slot, builderIndex)).toBe(2);

    // Other builders and slots are counted separately
    expect(cache.seenCount(slot, builderIndex + 1)).toBe(0);
    expect(cache.seenCount(slot + 1, builderIndex)).toBe(0);
  });

  it("should prune slots older than SLOTS_RETAINED", () => {
    cache.add(slot, builderIndex, parentBlockHash, parentBlockRoot);
    cache.prune(slot + 10);

    expect(cache.isKnown(slot, builderIndex, parentBlockHash, parentBlockRoot)).toBe(false);
    expect(cache.seenCount(slot, builderIndex)).toBe(0);
    expect(() => cache.add(slot, builderIndex, parentBlockHash, parentBlockRoot)).toThrow();
  });
});
