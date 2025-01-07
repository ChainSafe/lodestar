import {beforeEach, describe, expect, it} from "vitest";
import {BeaconProposerCache} from "../../../src/chain/beaconProposerCache.js";

describe("BeaconProposerCache", () => {
  const suggestedFeeRecipient = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const feeRecipient1 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const feeRecipient2 = "0xcccccccccccccccccccccccccccccccccccccccc";

  const validatorIndex1 = 23;
  const validatorIndex2 = 43;
  const unknownValidatorIndex = 32;

  let cache: BeaconProposerCache;

  beforeEach(() => {
    // max 2 items
    cache = new BeaconProposerCache({suggestedFeeRecipient});
    cache.add(1, {validatorIndex: validatorIndex1, feeRecipient: feeRecipient1});
    cache.add(3, {validatorIndex: validatorIndex2, feeRecipient: feeRecipient2});
  });

  it("get default", () => {
    expect(cache.getOrDefault(unknownValidatorIndex)).toBe(suggestedFeeRecipient);
  });

  it("get what has been set", () => {
    expect(cache.get(validatorIndex1)).toBe(feeRecipient1);
  });

  it("override and get latest", () => {
    const newFeeRecipient = "0xdddddddddddddddddddddddddddddddddddddddd";
    cache.add(5, {validatorIndex: validatorIndex1, feeRecipient: newFeeRecipient});
    expect(cache.get(validatorIndex1)).toBe(newFeeRecipient);
  });

  it("prune", () => {
    cache.prune(4);

    // Default for what has been pruned
    expect(cache.getOrDefault(validatorIndex1)).toBe(suggestedFeeRecipient);

    // Original for what hasn't been pruned
    expect(cache.get(validatorIndex2)).toBe(feeRecipient2);
  });
});
