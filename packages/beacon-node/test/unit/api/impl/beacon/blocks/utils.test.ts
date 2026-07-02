import {describe, expect, it} from "vitest";
import {countColumnsPublishedWithZeroPeers} from "../../../../../../src/api/impl/beacon/blocks/utils.js";

describe("api - beacon - blocks - countColumnsPublishedWithZeroPeers", () => {
  it("counts newly introduced columns published to zero peers", () => {
    // none of the columns were already in the seen cache, all reached zero peers
    expect(countColumnsPublishedWithZeroPeers([0, 0, 0], [false, false, false])).toBe(3);
  });

  it("ignores zero-peer columns that a peer already gossiped to us (benign duplicates)", () => {
    // the buildoor case: peers gossiped every column to us first, so all publishes are duplicates
    expect(countColumnsPublishedWithZeroPeers([0, 0, 0], [true, true, true])).toBe(0);
  });

  it("still counts a zero-peer column cached via a non-gossip path (engine/getBlobs, req/resp, recovery)", () => {
    // Such columns are not necessarily on the network, so the caller passes them as `false` (not
    // gossiped) and their 0-peer publish is a real propagation failure that must warn (see #9580 review).
    expect(countColumnsPublishedWithZeroPeers([0, 0], [false, false])).toBe(2);
  });

  it("only counts newly introduced zero-peer columns in a mixed batch", () => {
    // index 0: not gossiped to us, zero peers -> counted
    // index 1: already gossiped to us, zero peers -> benign duplicate, not counted
    // index 2: not gossiped to us, reached peers -> not counted
    // index 3: already gossiped to us, reached peers -> not counted
    expect(countColumnsPublishedWithZeroPeers([0, 0, 5, 5], [false, true, false, true])).toBe(1);
  });

  it("never counts columns that reached at least one peer", () => {
    expect(countColumnsPublishedWithZeroPeers([1, 2, 3], [false, false, false])).toBe(0);
  });

  it("returns 0 for an empty batch", () => {
    expect(countColumnsPublishedWithZeroPeers([], [])).toBe(0);
  });
});
