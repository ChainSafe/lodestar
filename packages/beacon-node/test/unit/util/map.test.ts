import {describe, it, expect, beforeEach} from "vitest";
import {OrderedMap} from "../../../src/util/map.js";

describe("OrderedMap", () => {
  let orderedMap: OrderedMap<string, number>;

  beforeEach(() => {
    orderedMap = new OrderedMap();
  });

  it("should add a key-value pair", () => {
    orderedMap.set("test", 1);
    expect(orderedMap.get("test")).toBe(1);
  });

  it("should delete a key-value pair", () => {
    orderedMap.set("test", 1);
    orderedMap.delete("test", true);
    expect(orderedMap.get("test")).toBeUndefined();
  });

  it("should return keys in order", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    orderedMap.set("test3", 3);
    const keys = Array.from(orderedMap.keys());
    expect(keys).toEqual(["test1", "test2", "test3"]);
  });

  it("should return values in order", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    orderedMap.set("test3", 3);
    const values = Array.from(orderedMap.values());
    expect(values).toEqual([1, 2, 3]);
  });

  it("should return the correct size", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    expect(orderedMap.size()).toBe(2);
  });

  it("should return the first and last keys correctly", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    expect(orderedMap.firstKey()).toBe("test1");
    expect(orderedMap.lastKey()).toBe("test2");
  });

  it("should return the first and last values correctly", () => {
    orderedMap.set("test1", 1);
    orderedMap.set("test2", 2);
    expect(orderedMap.firstValue()).toBe(1);
    expect(orderedMap.lastValue()).toBe(2);
  });

  it("should check if a key exists", () => {
    orderedMap.set("test", 1);
    expect(orderedMap.has("test")).toBe(true);
    expect(orderedMap.has("nonexistent")).toBe(false);
  });
});
