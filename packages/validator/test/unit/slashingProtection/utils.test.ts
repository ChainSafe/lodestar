import {describe, it, expect} from "vitest";
import {minEpoch} from "../../../src/slashingProtection/utils.js";

describe("slashingProtection / utils / minEpoch", () => {
  it("should return the minimum epoch from an array of epochs", () => {
    expect(minEpoch([15, 10, 20, 30, 5, 1, 50])).toBe(1);
  });

  it("should return the only epoch if epochs array only contains one element", () => {
    expect(minEpoch([10])).toBe(10);
  });

  it("should return null if epochs array is empty", () => {
    expect(minEpoch([])).toBe(null);
  });

  it("should not throw 'RangeError: Maximum call stack size exceeded' for huge epoch arrays", () => {
    expect(() => minEpoch(Array.from({length: 1e6}, (_, index) => index))).not.toThrow(RangeError);
  });
});
