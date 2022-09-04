import {expect} from "chai";

import {isValidAddress} from "../../../src/util/address.js";

describe("Eth address helper", () => {
  it("should be valid address", () => {
    expect(isValidAddress("0x0000000000000000000000000000000000000000")).to.equal(true);
    expect(isValidAddress("0x1C2D4a6b0e85e802952968d2DFBA985f2F5f339d")).to.equal(true);
  });

  it("should not be valid address", () => {
    expect(isValidAddress("0x00")).to.equal(false);
    expect(isValidAddress("TPB")).to.equal(false);
    expect(isValidAddress(null as any)).to.equal(false);
  });
});
