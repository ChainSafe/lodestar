import {describe, it, expect} from "vitest";
import {isValidAddress} from "../../../src/util/address.js";

describe("Eth address helper", () => {
  it("should be valid address", () => {
    expect(isValidAddress("0x0000000000000000000000000000000000000000")).toBe(true);
    expect(isValidAddress("0x1C2D4a6b0e85e802952968d2DFBA985f2F5f339d")).toBe(true);
  });

  it("should not be valid address", () => {
    expect(isValidAddress("0x00")).toBe(false);
    expect(isValidAddress("TPB")).toBe(false);
    expect(isValidAddress(null as any)).toBe(false);
  });
});
