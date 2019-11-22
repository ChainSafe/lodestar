import {describe, it} from "mocha";
import {RoundRobinArray} from "../../../../src/sync/utils/robin";
import {expect} from "chai";

describe("Round robin array", function () {

  it("should return item", function () {
    const robin = new RoundRobinArray([1, 2, 3]);
    const item = robin.next();
    expect(item).to.not.be.null;
  });

  it("should not return same item twice", function () {
    const robin = new RoundRobinArray([1, 2, 3]);
    const item1 = robin.next();
    const item2 = robin.next();
    expect(item1).to.not.be.equal(item2);
  });
});