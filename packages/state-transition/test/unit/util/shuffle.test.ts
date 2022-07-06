import {expect} from "chai";
import {unshuffleList} from "../../../src/index.js";

describe("util / shuffle", () => {
  const testCases: {
    id: string;
    input: number[];
    res: number[];
  }[] = [
    // Values from `unshuffleList()` at commit https://github.com/ChainSafe/lodestar/commit/ec065635ca7da7f3788da018bd68c4900f0427d2
    {
      id: "8 elements",
      input: [0, 1, 2, 3, 4, 5, 6, 7],
      res: [6, 3, 4, 0, 1, 5, 7, 2],
    },
    {
      id: "16 elements",
      input: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      res: [8, 4, 11, 7, 10, 6, 0, 3, 15, 12, 5, 14, 1, 9, 13, 2],
    },
  ];

  const seed = new Uint8Array([42, 32]);

  for (const {id, input, res} of testCases) {
    it(id, () => {
      unshuffleList(input, seed);
      expect(input).to.deep.equal(res);
    });
  }
});
