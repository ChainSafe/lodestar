import {getAggregationBits} from "../../../src/services/utils";
import {expect} from "chai";

describe("getAggregationBits", function () {
  it("should return correct bits", function () {
    const bits = getAggregationBits(4, 3);
    expect(bits.length).to.be.equal(4);
    expect(bits[3]).to.be.true;
    expect(bits[0]).to.be.false;
    expect(bits[1]).to.be.false;
    expect(bits[2]).to.be.false;
  });
});
