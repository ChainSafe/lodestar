import {expect} from "chai";

import {findLastIndex, isNonStrictSuperSet, LinkedList} from "../../../src/util/array";

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

describe("LinkedList", () => {
  let list: LinkedList<number>;

  beforeEach(() => {
    list = new LinkedList<number>();
  });

  it("pop", () => {
    expect(list.pop() === null);
    expect(list.length).to.be.equal(0);
    let count = 100;
    for (let i = 0; i < count; i++) list.push(i + 1);

    while (count > 0) {
      expect(list.length).to.be.equal(count);
      expect(list.pop()).to.be.equal(count);
      count--;
    }

    expect(list.pop() === null);
    expect(list.length).to.be.equal(0);
  });

  it("shift", () => {
    expect(list.shift() === null);
    expect(list.length).to.be.equal(0);
    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);

    for (let i = 0; i < count; i++) {
      expect(list.length).to.be.equal(count - i);
      expect(list.shift()).to.be.equal(i);
    }

    expect(list.shift() === null);
    expect(list.length).to.be.equal(0);
  });

  it("toArray", () => {
    expect(list.toArray()).to.be.deep.equal([]);

    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);

    expect(list.length).to.be.equal(count);
    expect(list.toArray()).to.be.deep.equal(Array.from({length: count}, (_, i) => i));
  });

  it("prune", () => {
    const count = 100;
    for (let i = 0; i < count; i++) list.push(i);

    list.clear();

    expect(list.toArray()).to.be.deep.equal([]);
    expect(list.length).to.be.equal(0);
  });
});

describe("isNonStrictSuperSet", () => {
  const superSet = [1, 3, 5];
  const toName = (arr: number[]): string => {
    return "[" + arr.join(",") + "]";
  };
  const testCases: {arr: number[]; expected: boolean}[] = [
    {arr: [1, 2, 3, 4], expected: false},
    {arr: [1, 2, 3], expected: false},
    {arr: [1, 6], expected: false},
    {arr: [4], expected: false},
    {arr: [], expected: true},
    {arr: [1], expected: true},
    {arr: [1, 3], expected: true},
    {arr: [1, 5], expected: true},
    {arr: [3, 5], expected: true},
    {arr: [1, 3, 5], expected: true},
  ];

  for (const {arr, expected} of testCases) {
    it(`${toName(superSet)} ${expected ? "should be super set of" : "should NOT be superset of"} ${toName(
      arr
    )}`, () => {
      expect(isNonStrictSuperSet(superSet, arr)).to.be.equal(expected);
    });
  }
});
