import {expect} from "chai";
import {chunkifyInclusiveRange} from "../../../src/utils/chunkify.js";

describe("utils / chunkifyInclusiveRange", () => {
  const testCases: {id: string; from: number; to: number; max: number; result: [number, number][]}[] = [
    {id: "single", from: 0, to: 0, max: 1, result: [[0, 0]]},
    {id: "multiple", from: 0, to: 4, max: 5, result: [[0, 4]]},
    {
      id: "split",
      from: 0,
      to: 4,
      max: 2,
      result: [
        [0, 1],
        [2, 3],
        [4, 4],
      ],
    },
  ];

  for (const {id, from, to, max, result} of testCases) {
    it(id, () => {
      expect(chunkifyInclusiveRange(from, to, max)).to.deep.equal(result);
    });
  }
});
