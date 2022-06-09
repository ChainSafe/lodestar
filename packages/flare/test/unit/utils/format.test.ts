import {expect} from "chai";
import {parseRange} from "../../../src/util/format.js";

describe("utils / format", () => {
  const testCases: {range: string; indexes: number[]}[] = [
    {range: "0..9", indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]},
    {range: "0..0", indexes: [0]},
    {range: "9..9", indexes: [9]},
  ];

  for (const {range, indexes} of testCases) {
    it(range, () => {
      expect(parseRange(range)).to.deep.equal(indexes);
    });
  }
});
