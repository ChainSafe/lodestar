import {expect} from "chai";
import {batchItems} from "../../../src/util/batch.js";

describe("util / batch", function () {
  const testCases: {items: string[]; expected: string[][]}[] = [
    {items: [], expected: []},
    {items: ["1"], expected: [["1"]]},
    {items: ["1", "2"], expected: [["1", "2"]]},
    {items: ["1", "2", "3"], expected: [["1", "2"], ["3"]]},
    {
      items: ["1", "2", "3", "4"],
      expected: [
        ["1", "2"],
        ["3", "4"],
      ],
    },
    {items: ["1", "2", "3", "4", "5"], expected: [["1", "2"], ["3", "4"], ["5"]]},
    {
      items: ["1", "2", "3", "4", "5", "6"],
      expected: [
        ["1", "2"],
        ["3", "4"],
        ["5", "6"],
      ],
    },
    // Ignore item 7 since it's over the max
    {
      items: ["1", "2", "3", "4", "5", "6", "7"],
      expected: [
        ["1", "2"],
        ["3", "4"],
        ["5", "6"],
      ],
    },
  ];

  for (const {items: pubkeys, expected} of testCases) {
    it(`Batch ${pubkeys.length} items`, () => {
      expect(batchItems(pubkeys, {batchSize: 2, maxBatches: 3})).to.deep.equal(expected);
    });
  }
});
