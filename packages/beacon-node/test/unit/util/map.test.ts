import {expect} from "chai";
import {OrderedMap} from "../../../src/util/map.js";

describe("OrderedMap", () => {
  let orderedMap: OrderedMap<string, number>;

  beforeEach(() => {
    orderedMap = new OrderedMap();
  });

  it("should add a key-value pair", () => {
    orderedMap.set("test", 1);
    expect(orderedMap.get("test")).to.be.equal(1);
  });

  it("should delete a key-value pair", () => {
    orderedMap.set("test", 1);
    orderedMap.delete("test");
    expect(orderedMap.get("test")).to.be.undefined;
  });

  it("should return keys in order", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    orderedMap.set("test3", 3);
    const keys = Array.from(orderedMap.keys());
    expect(keys).to.be.deep.equal(["test1", "test2", "test3"]);
  });

  it("should return values in order", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    orderedMap.set("test3", 3);
    const values = Array.from(orderedMap.values());
    expect(values).to.be.deep.equal([1, 2, 3]);
  });

  it("should return the correct size", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    expect(orderedMap.size()).to.be.equal(2);
  });

  it("should return the first and last keys correctly", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    expect(orderedMap.firstKey()).to.be.equal("test1");
    expect(orderedMap.lastKey()).to.be.equal("test2");
  });

  it("should return the first and last values correctly", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    expect(orderedMap.firstValue()).to.be.equal(1);
    expect(orderedMap.lastValue()).to.be.equal(2);
  });

  it("should check if a key exists", () => {
    orderedMap.set("test", 1);
    expect(orderedMap.has("test")).to.be.equal(true);
    expect(orderedMap.has("nonexistent")).to.be.equal(false);
  });
});
