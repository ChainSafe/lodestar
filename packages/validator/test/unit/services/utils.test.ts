import {expect} from "chai";
import {getAggregationBits} from "../../../src/services/utils";

describe("getAggregationBits", function () {
  it("should return correct bits", function () {
    const bits = getAggregationBits(4, 3);
    expect(bits).to.deep.equal([false, false, false, true]);
  });
});
