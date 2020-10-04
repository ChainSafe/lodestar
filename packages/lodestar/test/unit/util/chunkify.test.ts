import {expect} from "chai";
import {chunkifyInclusiveRange} from "../../../src/util/chunkify";

describe("chunkifyInclusiveRange", () => {
  const testCases: {
    from: number;
    to: number;
    chunks: number;
    result: number[][];
  }[] = [
    {
      from: 0,
      to: 0,
      chunks: 0,
      result: [[0, 0]],
    },
    {
      from: 0,
      to: 4,
      chunks: 1,
      result: [[0, 4]],
    },
    {
      from: 0,
      to: 4,
      chunks: 2,
      result: [
        [0, 2],
        [3, 4],
      ],
    },
    {
      from: 0,
      to: 4,
      chunks: 3,
      result: [
        [0, 1],
        [2, 3],
        [4, 4],
      ],
    },
    {
      from: 0,
      to: 4,
      chunks: 4,
      result: [
        [0, 1],
        [2, 3],
        [4, 4],
      ],
    },
    {
      from: 0,
      to: 4,
      chunks: 5,
      result: [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ],
    },
    {
      from: 1000,
      to: 2000,
      chunks: 5,
      result: [
        [1000, 1200],
        [1201, 1401],
        [1402, 1602],
        [1603, 1803],
        [1804, 2000],
      ],
    },
  ];

  for (const {from, to, chunks, result} of testCases) {
    it(`[${from},${to}] / ${chunks}`, () => {
      expect(chunkifyInclusiveRange(from, to, chunks)).to.deep.equal(result);
    });
  }
});
