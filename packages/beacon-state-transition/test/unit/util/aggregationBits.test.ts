import {config} from "@chainsafe/lodestar-config/minimal";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {getUint8ByteToBitBooleanArray, bitlistToUint8Array} from "../../../src";

const BITS_PER_BYTE = 8;

describe("aggregationBits", function () {
  const testCases: {name: string; data: boolean[]; numBytes: number}[] = [
    {name: "8 bits all true", data: [true, true, true, true, true, true, true, true], numBytes: 1},
    {name: "8 bits with true and false", data: [false, false, false, false, false, true, false, true], numBytes: 1},
    {
      name: "10 bits with true and false",
      data: [false, false, false, false, false, true, false, true, true, true],
      numBytes: 2,
    },
    {
      name: "" + config.params.MAX_VALIDATORS_PER_COMMITTEE + " bits all true",
      data: Array.from({length: config.params.MAX_VALIDATORS_PER_COMMITTEE}, () => true),
      numBytes: Math.ceil(config.params.MAX_VALIDATORS_PER_COMMITTEE / 8),
    },
  ];

  it("getUint8ByteToBitBooleanArray", () => {
    expect(getUint8ByteToBitBooleanArray(1)).to.be.deep.equal([true, false, false, false, false, false, false, false]);
    expect(getUint8ByteToBitBooleanArray(5)).to.be.deep.equal([true, false, true, false, false, false, false, false]);
  });

  for (const {name, data, numBytes} of testCases) {
    it(name, () => {
      const tree = config.types.phase0.CommitteeBits.createTreeBackedFromStruct(data as List<boolean>);
      const aggregationBytes = bitlistToUint8Array(tree, config.types.phase0.CommitteeBits);
      expect(aggregationBytes.length).to.be.equal(numBytes, "number of bytes is incorrect");
      const aggregationBits: boolean[] = [];
      for (let i = 0; i < tree.length; i++) {
        aggregationBits.push(getAggregationBit(aggregationBytes, i));
      }
      expect(aggregationBits).to.be.deep.equal(data, "incorrect extracted aggregationBits");
    });
  }

  it("getUint8ByteToBitBooleanArray - all values in 8 bytes", () => {
    for (let i = 0; i <= 0xff; i++) {
      const boolArr = getUint8ByteToBitBooleanArray(i);
      const tree = config.types.phase0.CommitteeBits.createTreeBackedFromStruct(boolArr as List<boolean>);
      const bytes = tree.serialize();
      expect(bytes[0]).to.equal(i, `Wrong serialization of ${i}: ${JSON.stringify(boolArr)}`);
    }
  });
});

/**
 * Get aggregation bit (true/false) from an aggregation bytes array and validator index in committee.
 * Notice: If we want to access the bit in batch, using this method is not efficient, check the performance
 *         test for an example of how to do that.
 */
export function getAggregationBit(attBytes: number[] | Uint8Array, indexInCommittee: number): boolean {
  const byteIndex = Math.floor(indexInCommittee / BITS_PER_BYTE);
  const indexInByte = indexInCommittee % BITS_PER_BYTE;
  return getUint8ByteToBitBooleanArray(attBytes[byteIndex])[indexInByte];
}
