import {describe, expect, it} from "vitest";
import {ProportionalBidPolicy} from "../../../src/services/bidPolicy.js";

describe("ProportionalBidPolicy", () => {
  it("offers a share of the payload value", () => {
    const policy = new ProportionalBidPolicy({shareBps: 9000, fixedCostGwei: 0, minValueGwei: 0});
    expect(policy.computeValue({payloadValueGwei: 1_000_000, coverableGwei: 10_000_000})).toEqual(900_000);
  });

  it("deducts the fixed cost", () => {
    const policy = new ProportionalBidPolicy({shareBps: 10_000, fixedCostGwei: 100, minValueGwei: 0});
    expect(policy.computeValue({payloadValueGwei: 1_000, coverableGwei: 10_000})).toEqual(900);
  });

  it("never bids below the minimum value", () => {
    const policy = new ProportionalBidPolicy({shareBps: 5000, fixedCostGwei: 0, minValueGwei: 800});
    expect(policy.computeValue({payloadValueGwei: 1_000, coverableGwei: 10_000})).toEqual(800);
  });

  it("never bids below zero", () => {
    const policy = new ProportionalBidPolicy({shareBps: 5000, fixedCostGwei: 1_000, minValueGwei: 0});
    expect(policy.computeValue({payloadValueGwei: 100, coverableGwei: 10_000})).toEqual(0);
  });

  it("caps at the maximum value", () => {
    const policy = new ProportionalBidPolicy({shareBps: 10_000, fixedCostGwei: 0, minValueGwei: 0, maxValueGwei: 500});
    expect(policy.computeValue({payloadValueGwei: 1_000, coverableGwei: 10_000})).toEqual(500);
  });

  it("declines if the builder cannot cover the value", () => {
    const policy = new ProportionalBidPolicy({shareBps: 10_000, fixedCostGwei: 0, minValueGwei: 0});
    expect(policy.computeValue({payloadValueGwei: 1_000, coverableGwei: 999})).toBeNull();
  });

  it("rejects an invalid share", () => {
    expect(() => new ProportionalBidPolicy({shareBps: 10_001, fixedCostGwei: 0, minValueGwei: 0})).toThrow();
  });

  it("rejects an invalid min and max configuration", () => {
    expect(
      () => new ProportionalBidPolicy({shareBps: 10_000, fixedCostGwei: 0, minValueGwei: 1, maxValueGwei: 0})
    ).toThrow();
  });
});
