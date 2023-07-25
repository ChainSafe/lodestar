import {expect} from "chai";
import {OrderedSet} from "../../../src/util/set.js";

describe("OrderedSet", () => {
  let orderedSet: OrderedSet<number>;

  beforeEach(() => {
    orderedSet = new OrderedSet<number>();
  });

  it("should add items correctly", () => {
    orderedSet.add(1);
    orderedSet.add(2);
    orderedSet.add(3);
    expect(orderedSet.size()).to.be.equal(3);
    expect(orderedSet.toArray()).to.be.deep.equal([1, 2, 3]);
  });

  it("should not add duplicate items", () => {
    orderedSet.add(1);
    orderedSet.add(1);
    expect(orderedSet.size()).to.be.equal(1);
    expect(orderedSet.toArray()).to.be.deep.equal([1]);
  });

  it("should delete items correctly", () => {
    orderedSet.add(1);
    orderedSet.add(2);
    orderedSet.add(3);
    orderedSet.delete(2);
    expect(orderedSet.size()).to.be.equal(2);
    expect(orderedSet.toArray()).to.be.deep.equal([1, 3]);
  });

  it("should return first item correctly", () => {
    orderedSet.add(1);
    orderedSet.add(2);
    expect(orderedSet.first()).to.be.equal(1);
  });

  it("should return last item correctly", () => {
    orderedSet.add(1);
    orderedSet.add(2);
    expect(orderedSet.last()).to.be.equal(2);
  });

  it("should return null for first and last if set is empty", () => {
    expect(orderedSet.first()).to.be.null;
    expect(orderedSet.last()).to.be.null;
  });

  it("should return correctly whether an item is in the set", () => {
    orderedSet.add(1);
    expect(orderedSet.has(1)).to.be.equal(true);
    expect(orderedSet.has(2)).to.be.equal(false);
  });

  it("should return correct size", () => {
    expect(orderedSet.size()).to.be.equal(0);
    orderedSet.add(1);
    expect(orderedSet.size()).to.be.equal(1);
    orderedSet.add(2);
    expect(orderedSet.size()).to.be.equal(2);
    orderedSet.delete(1);
    expect(orderedSet.size()).to.be.equal(1);
  });
});
