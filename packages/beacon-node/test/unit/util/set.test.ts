import {describe, it, expect, beforeEach} from "vitest";
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
    expect(orderedSet.size).toBe(3);
    expect(orderedSet.toArray()).toEqual([1, 2, 3]);
  });

  it("should not add duplicate items", () => {
    orderedSet.add(1);
    orderedSet.add(1);
    expect(orderedSet.size).toBe(1);
    expect(orderedSet.toArray()).toEqual([1]);
  });

  it("should delete items correctly", () => {
    orderedSet.add(1);
    orderedSet.add(2);
    orderedSet.add(3);
    orderedSet.delete(2, true);
    expect(orderedSet.size).toBe(2);
    expect(orderedSet.toArray()).toEqual([1, 3]);
  });

  it("should return first item correctly", () => {
    orderedSet.add(1);
    orderedSet.add(2);
    expect(orderedSet.first()).toBe(1);
  });

  it("should return last item correctly", () => {
    orderedSet.add(1);
    orderedSet.add(2);
    expect(orderedSet.last()).toBe(2);
  });

  it("should return null for first and last if set is empty", () => {
    expect(orderedSet.first()).toBeNull();
    expect(orderedSet.last()).toBeNull();
  });

  it("should return correctly whether an item is in the set", () => {
    orderedSet.add(1);
    expect(orderedSet.has(1)).toBe(true);
    expect(orderedSet.has(2)).toBe(false);
  });

  it("should return correct size", () => {
    expect(orderedSet.size).toBe(0);
    orderedSet.add(1);
    expect(orderedSet.size).toBe(1);
    orderedSet.add(2);
    expect(orderedSet.size).toBe(2);
    orderedSet.delete(1, true);
    expect(orderedSet.size).toBe(1);
  });
});
