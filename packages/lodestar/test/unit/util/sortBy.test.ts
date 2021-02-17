import {expect} from "chai";
import {sortBy} from "../../../src/util/sortBy";

describe("util / sortBy", () => {
  const a = {id: "a", x: 1, y: 2};
  const b = {id: "b", x: 1, y: 1};
  const c = {id: "c", x: 1, y: 1}; // Duplicated element to test stable sort
  const d = {id: "d", x: 2, y: 1};
  const e = {id: "e", x: 2, y: 1};
  const f = {id: "f", x: 2, y: 2};

  type T = typeof a;

  const testCases: {
    id: string;
    inputArr: T[];
    sortedArr: T[];
    conditions: ((item: T) => number)[];
  }[] = [
    {
      id: "sort by x",
      inputArr: [/**x=2*/ d, e, f, /**x=1*/ a, b, c],
      sortedArr: [/**x=1*/ a, b, c, /**x=2*/ d, e, f],
      conditions: [(_a) => _a.x],
    },
    {
      id: "sort by x (test stable sort)",
      inputArr: [/**x=2*/ f, e, d, /**x=1*/ c, b, a],
      sortedArr: [/**x=1*/ c, b, a, /**x=2*/ f, e, d],
      conditions: [(_a) => _a.x],
    },
    {
      id: "sort by x then y",
      inputArr: [d, e, f, a, b, c],
      sortedArr: [b, c, a, d, e, f],
      conditions: [(_a) => _a.x, (_a) => _a.y],
    },
    {
      id: "sort by x then y (test stable sort)",
      inputArr: [f, e, d, c, b, a],
      sortedArr: [c, b, a, e, d, f],
      conditions: [(_a) => _a.x, (_a) => _a.y],
    },
  ];

  for (const {id, inputArr, sortedArr, conditions} of testCases) {
    it(id, () => {
      const _inputArr = [...inputArr]; // Copy to test immutability
      const _sortedArr = sortBy(inputArr, ...conditions);
      expect(_sortedArr).to.deep.equal(sortedArr, "Wrong sortedArr");
      expect(inputArr).to.deep.equal(_inputArr, "inputArr was mutated");
    });
  }
});
