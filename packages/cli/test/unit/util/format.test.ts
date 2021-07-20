import {expect} from "chai";
import {parseRange} from "../../../src/util";

describe("util / format / parseRange", () => {
  const testCases: {range: string; res: number[]}[] = [
    {range: "0..0", res: [0]},
    {range: "0..1", res: [0, 1]},
    {range: "4..8", res: [4, 5, 6, 7, 8]},
  ];

  for (const {range, res} of testCases) {
    it(range, () => {
      expect(parseRange(range)).to.deep.equal(res);
    });
  }
});
