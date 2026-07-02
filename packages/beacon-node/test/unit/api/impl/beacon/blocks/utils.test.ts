import {describe, expect, it} from "vitest";
import {countColumnsPublishedWithZeroPeers} from "../../../../../../src/api/impl/beacon/blocks/utils.js";

describe("api - beacon - blocks - countColumnsPublishedWithZeroPeers", () => {
  it("counts newly introduced columns published to zero peers", () => {
    // none of the columns were already in the seen cache, all reached zero peers
    expect(countColumnsPublishedWithZeroPeers([0, 0, 0], [false, false, false])).toBe(3);
  });

  it("ignores zero-peer columns that were already in the seen cache (benign duplicates)", () => {
    // the buildoor case: peers gossiped every column to us first, so all publishes are duplicates
    expect(countColumnsPublishedWithZeroPeers([0, 0, 0], [true, true, true])).toBe(0);
  });

  it("only counts newly introduced zero-peer columns in a mixed batch", () => {
    // index 0: newly introduced, zero peers -> counted
    // index 1: already present, zero peers -> benign duplicate, not counted
    // index 2: newly introduced, reached peers -> not counted
    // index 3: already present, reached peers -> not counted
    expect(countColumnsPublishedWithZeroPeers([0, 0, 5, 5], [false, true, false, true])).toBe(1);
  });

  it("never counts columns that reached at least one peer", () => {
    expect(countColumnsPublishedWithZeroPeers([1, 2, 3], [false, false, false])).toBe(0);
  });

  it("returns 0 for an empty batch", () => {
    expect(countColumnsPublishedWithZeroPeers([], [])).toBe(0);
  });
});
