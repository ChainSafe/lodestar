import {config} from "@chainsafe/lodestar-config/minimal";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {PRE_COMPUTED_BYTE_TO_BOOLEAN_ARRAY, getAggregationBytes, getAggregationBit} from "../../../src";

describe("getAggregationBitsSSZChunks", function () {
  const testCases: {name: string; data: boolean[]}[] = [
    {name: "8 bits all true", data: [true, true, true, true, true, true, true, true]},
    {name: "8 bits with true and false", data: [false, false, false, false, false, true, false, true]},
    {name: "10 bits with true and fase", data: [false, false, false, false, false, true, false, true, true, true]},
    {
      name: "" + config.params.MAX_VALIDATORS_PER_COMMITTEE + " bits all true",
      data: Array.from({length: config.params.MAX_VALIDATORS_PER_COMMITTEE}, () => true),
    },
  ];

  it("PRE_COMPUTED_BYTE_TO_BOOLEAN_ARRAY", () => {
    expect(PRE_COMPUTED_BYTE_TO_BOOLEAN_ARRAY[1]).to.be.deep.equal([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(PRE_COMPUTED_BYTE_TO_BOOLEAN_ARRAY[5]).to.be.deep.equal([
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  for (const {name, data} of testCases) {
    it(name, () => {
      const tree = config.types.phase0.CommitteeBits.createTreeBackedFromStruct(data as List<boolean>);
      const aggregationBytes = getAggregationBytes(config, tree);
      const aggregationBits: boolean[] = [];
      for (let i = 0; i < tree.length; i++) {
        aggregationBits.push(getAggregationBit(aggregationBytes, i));
      }
      expect(aggregationBits).to.be.deep.equal(data);
    });
  }
});
