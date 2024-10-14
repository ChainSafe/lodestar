import {expect, describe, it, beforeEach} from "vitest";
import {BeaconProposerCache} from "../../../src/chain/beaconProposerCache.js";

const suggestedFeeRecipient = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
describe("BeaconProposerCache", () => {
  let cache: BeaconProposerCache;

  beforeEach(() => {
    // max 2 items
    cache = new BeaconProposerCache({suggestedFeeRecipient});
    cache.add(1, {validatorIndex: 23, feeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"});
    cache.add(3, {validatorIndex: 43, feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc"});
  });

  it("get default", () => {
    expect(cache.get(32)).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("get what has been set", () => {
    expect(cache.get(23)).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("override and get latest", () => {
    cache.add(5, {validatorIndex: 23, feeRecipient: "0xdddddddddddddddddddddddddddddddddddddddd"});
    expect(cache.get(23)).toBe("0xdddddddddddddddddddddddddddddddddddddddd");
  });

  it("prune", () => {
    cache.prune(4);

    // Default for what has been pruned
    expect(cache.get(23)).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    // Original for what hasn't been pruned
    expect(cache.get(43)).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
  });
});
