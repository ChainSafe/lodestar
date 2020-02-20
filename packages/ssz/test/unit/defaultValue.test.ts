import {expect} from "chai";
import {describe, it} from "mocha";

import {booleanType, byteType} from "../../src";
import {ArrayObject, bigint16Type, bitList100Type, bitVector100Type, byteVector100Type, bytes2Type, number16Type, number16Vector6Type, number16List100Type} from "./objects";

describe("defaultValue", () => {
  const testCases: {
    type: any;
    expected: any;
  }[] = [
    {type: byteType, expected: 0},
    {type: bigint16Type, expected: BigInt(0)},
    {type: booleanType, expected: false},
    {type: bitList100Type, expected: []},
    {type: bitVector100Type, expected: Array.from({length: 100}, () => false)},
    {type: byteVector100Type, expected: Buffer.alloc(100)},
    {type: bytes2Type, expected: Buffer.alloc(2)},
    {type: number16List100Type, expected: []},
    {type: ArrayObject, expected: {v: []}},
  ];
  for (const {type, expected} of testCases) {
    it(`should correctly get the defaultValue for ${type}`, () => {
      const actual = type.defaultValue();
      expect(type.equals(actual, expected));
    });
  }
});
