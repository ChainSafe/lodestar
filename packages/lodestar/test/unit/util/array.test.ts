import {expect} from "chai";

import {findLastIndex} from "../../../src/util/array";

describe("findLastIndex", () => {
  it("should return the last index that matches a predicate", () => {
    expect(findLastIndex([1, 2, 3, 4], (n) => n % 2 == 0)).to.eql(3);
    expect(findLastIndex([1, 2, 3, 4, 5], (n) => n % 2 == 0)).to.eql(3);
    expect(findLastIndex([1, 2, 3, 4, 5], () => true)).to.eql(4);
  });

  it("should return -1 if there are no matches", () => {
    expect(findLastIndex([1, 3, 5], (n) => n % 2 == 0)).to.eql(-1);
    expect(findLastIndex([1, 2, 3, 4, 5], () => false)).to.eql(-1);
  });
});
