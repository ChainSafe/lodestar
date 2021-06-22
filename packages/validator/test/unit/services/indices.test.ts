import {expect} from "chai";
import {pubkeysToBatches} from "../../../src/services/indices";

describe("pubkeysToBatches", function () {
  const testCases: {pubkeys: string[]; expected: string[][][]}[] = [
    {pubkeys: [], expected: [[[]]]},
    {pubkeys: ["1"], expected: [[["1"]]]},
    {pubkeys: ["1", "2"], expected: [[["1", "2"]]]},
    {pubkeys: ["1", "2", "3"], expected: [[["1", "2"], ["3"]]]},
    {
      pubkeys: ["1", "2", "3", "4"],
      expected: [
        [
          ["1", "2"],
          ["3", "4"],
        ],
      ],
    },
    {pubkeys: ["1", "2", "3", "4", "5"], expected: [[["1", "2"], ["3", "4"], ["5"]]]},
    {
      pubkeys: ["1", "2", "3", "4", "5", "6"],
      expected: [
        [
          ["1", "2"],
          ["3", "4"],
          ["5", "6"],
        ],
      ],
    },
    // new batch
    {
      pubkeys: ["1", "2", "3", "4", "5", "6", "7"],
      expected: [
        [
          ["1", "2"],
          ["3", "4"],
          ["5", "6"],
        ],
        [["7"]],
      ],
    },
  ];
  const maxPubkeysPerRequest = 2;
  const maxRequesPerBatch = 3;
  for (const {pubkeys, expected} of testCases) {
    it(`should work with ${pubkeys.length} pubkeys`, () => {
      expect(pubkeysToBatches(pubkeys, maxPubkeysPerRequest, maxRequesPerBatch)).to.be.deep.equals(expected);
    });
  }
});
