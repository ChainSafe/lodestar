import {describe, it, expect, beforeEach} from "vitest";
import {findLastIndex, LinkedList} from "../../../src/util/array.js";

describe("findLastIndex", () => {
  it("should return the last index that matches a predicate", () => {
    expect(findLastIndex([1, 2, 3, 4], (n) => n % 2 == 0)).toEqual(3);
    expect(findLastIndex([1, 2, 3, 4, 5], (n) => n % 2 == 0)).toEqual(3);
    expect(findLastIndex([1, 2, 3, 4, 5], () => true)).toEqual(4);
  });

  it("should return -1 if there are no matches", () => {
    expect(findLastIndex([1, 3, 5], (n) => n % 2 == 0)).toEqual(-1);
    expect(findLastIndex([1, 2, 3, 4, 5], () => false)).toEqual(-1);
  });
});

describe("LinkedList", () => {
  let list: LinkedList<number>;

  beforeEach(() => {
    list = new LinkedList<number>();
  });

  it("pop", () => {
    expect(list.pop()).toBeNull();
    expect(list.length).toBe(0);
    let count = 100;
    for (let i = 0; i < count; i++) list.push(i + 1);

    while (count > 0) {
      expect(list.length).toBe(count);
      expect(list.pop()).toBe(count);
      count--;
    }

    expect(list.pop()).toBeNull();
    expect(list.length).toBe(0);
  });

  it("shift", () => {
    expect(list.shift()).toBeNull();
    expect(list.length).toBe(0);
    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);

    for (let i = 0; i < count; i++) {
      expect(list.length).toBe(count - i);
      expect(list.shift()).toBe(i);
    }

    expect(list.shift()).toBeNull();
    expect(list.length).toBe(0);
  });

  it("deleteFirst", () => {
    expect(list.deleteFirst(0)).toBe(false);
    expect(list.length).toBe(0);
    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);

    // delete first item of the list
    expect(list.deleteFirst(0)).toBe(true);
    expect(list.length).toBe(count - 1);
    expect(list.first()).toBe(1);
    expect(list.last()).toBe(count - 1);

    // delete middle item of the list
    expect(list.deleteFirst(50)).toBe(true);
    expect(list.length).toBe(count - 2);
    expect(list.first()).toBe(1);
    expect(list.last()).toBe(count - 1);

    // delete last item of the list
    expect(list.deleteFirst(99)).toBe(true);
    expect(list.length).toBe(count - 3);
    expect(list.first()).toBe(1);
    expect(list.last()).toBe(98);
  });

  it("deleteLast", () => {
    expect(list.deleteLast(0)).toBe(false);
    expect(list.length).toBe(0);
    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);

    // delete last item of the list
    expect(list.deleteLast(99)).toBe(true);
    expect(list.length).toBe(count - 1);
    expect(list.first()).toBe(0);
    expect(list.last()).toBe(98);

    // delete middle item of the list
    expect(list.deleteLast(50)).toBe(true);
    expect(list.length).toBe(count - 2);
    expect(list.first()).toBe(0);
    expect(list.last()).toBe(98);

    // delete first item of the list
    expect(list.deleteLast(0)).toBe(true);
    expect(list.length).toBe(count - 3);
    expect(list.first()).toBe(1);
    expect(list.last()).toBe(98);
  });

  describe("moveToHead", () => {
    let list: LinkedList<number>;

    beforeEach(() => {
      list = new LinkedList<number>();
      list.push(1);
      list.push(2);
      list.push(3);
    });

    it("item is head", () => {
      list.moveToHead(1);
      expect(list.toArray()).toEqual([1, 2, 3]);
      expect(list.first()).toBe(1);
    });

    it("item is middle", () => {
      list.moveToHead(2);
      expect(list.toArray()).toEqual([2, 1, 3]);
      expect(list.first()).toBe(2);
    });

    it("item is tail", () => {
      list.moveToHead(3);
      expect(list.toArray()).toEqual([3, 1, 2]);
      expect(list.first()).toBe(3);
    });
  });

  describe("moveToSecond", () => {
    let list: LinkedList<number>;

    beforeEach(() => {
      list = new LinkedList<number>();
      list.push(1);
      list.push(2);
      list.push(3);
      list.push(4);
    });

    it("item is head", () => {
      list.moveToSecond(1);
      expect(list.toArray()).toEqual([1, 2, 3, 4]);
      expect(list.first()).toBe(1);
    });

    it("item is second", () => {
      list.moveToSecond(2);
      expect(list.toArray()).toEqual([1, 2, 3, 4]);
      expect(list.first()).toBe(1);
    });

    it("item is third", () => {
      list.moveToSecond(3);
      expect(list.toArray()).toEqual([1, 3, 2, 4]);
      expect(list.first()).toBe(1);
    });

    it("item is tail", () => {
      list.moveToSecond(4);
      expect(list.toArray()).toEqual([1, 4, 2, 3]);
      expect(list.first()).toBe(1);
      expect(list.last()).toBe(3);
    });
  });

  it("values", () => {
    expect(Array.from(list.values())).toEqual([]);
    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);
    const valuesArr = Array.from(list.values());
    expect(valuesArr).toEqual(Array.from({length: count}, (_, i) => i));
    const values = list.values();
    for (let i = 0; i < count; i++) {
      expect(values.next().value).toBe(i);
    }
  });

  describe("push", () => {
    const count = 100;
    beforeEach(() => {
      list = new LinkedList<number>();
      expect(list.length).toBe(0);
      for (let i = 0; i < count; i++) list.push(i);
      expect(list.length).toBe(count);
      expect(list.toArray()).toEqual(Array.from({length: count}, (_, i) => i));
    });

    it("push then pop", () => {
      for (let i = 0; i < count; i++) {
        expect(list.pop()).toBe(count - i - 1);
      }
      expect(list.length).toBe(0);
    });

    it("push then shift", () => {
      for (let i = 0; i < count; i++) {
        expect(list.shift()).toBe(i);
      }
      expect(list.length).toBe(0);
    });
  });

  describe("unshift", () => {
    const count = 100;
    beforeEach(() => {
      list = new LinkedList<number>();
      expect(list.length).toBe(0);
      for (let i = 0; i < count; i++) list.unshift(i);
      expect(list.length).toBe(count);
      expect(list.toArray()).toEqual(Array.from({length: count}, (_, i) => count - i - 1));
    });

    it("unshift then pop", () => {
      for (let i = 0; i < count; i++) {
        expect(list.pop()).toBe(i);
      }
      expect(list.length).toBe(0);
    });

    it("unshift then shift", () => {
      for (let i = 0; i < count; i++) {
        expect(list.shift()).toBe(count - i - 1);
      }

      expect(list.length).toBe(0);
    });
  });

  describe("insertAfter", () => {
    let list: LinkedList<number>;

    beforeEach(() => {
      list = new LinkedList<number>();
      list.push(1);
      list.push(2);
      list.push(3);
    });

    it("insert after 0", () => {
      // should do nothing
      list.insertAfter(0, 4);
      expect(list.toArray()).toEqual([1, 2, 3]);
      expect(list.first()).toBe(1);
      expect(list.last()).toBe(3);
    });

    it("insert after 1", () => {
      list.insertAfter(1, 4);
      expect(list.toArray()).toEqual([1, 4, 2, 3]);
      expect(list.first()).toBe(1);
      expect(list.last()).toBe(3);
    });

    it("insert after 2", () => {
      list.insertAfter(2, 4);
      expect(list.toArray()).toEqual([1, 2, 4, 3]);
      expect(list.first()).toBe(1);
      expect(list.last()).toBe(3);
    });

    it("insert after 3", () => {
      list.insertAfter(3, 4);
      expect(list.toArray()).toEqual([1, 2, 3, 4]);
      expect(list.first()).toBe(1);
      expect(list.last()).toBe(4);
    });
  });

  it("toArray", () => {
    expect(list.toArray()).toEqual([]);

    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);

    expect(list.length).toBe(count);
    expect(list.toArray()).toEqual(Array.from({length: count}, (_, i) => i));
  });

  it("prune", () => {
    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);

    list.clear();

    expect(list.toArray()).toEqual([]);
    expect(list.length).toBe(0);
  });

  describe("iterator", () => {
    const testCases: {count: number}[] = [{count: 0}, {count: 10}, {count: 100}];

    for (const {count} of testCases) {
      it(`should iterate over ${count} items`, () => {
        for (let i = 0; i < count; i++) {
          list.push(i);
        }

        let i = 0;
        for (const item of list) {
          expect(item).toBe(i);
          i++;
        }

        // make sure the list is the same
        expect(list.toArray()).toEqual(Array.from({length: count}, (_, i) => i));
      });
    }
  });

  describe("has", () => {
    let list: LinkedList<number>;

    beforeEach(() => {
      list = new LinkedList<number>();
      list.push(1);
      list.push(2);
      list.push(3);
    });

    it("should return true if the item is in the list", () => {
      expect(list.has(1)).toBe(true);
      expect(list.has(2)).toBe(true);
      expect(list.has(3)).toBe(true);
      expect(list.has(4)).toBe(false);
    });
  });
});
