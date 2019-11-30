import {expect} from "chai";
import {describe, it} from "mocha";
import BN from "bn.js";
import {BitList, BitVector} from "@chainsafe/bit-utils";

import {defaultValue, equals} from "../../src";
import {ArrayObject,} from "./objects";
import {stringifyType} from "./utils";

describe("defaultValue", () => {
  const testCases: {
    type: any;
    expected: any;
  }[] = [
    {type: "uint8", expected: 0},
    {type: "bigint8", expected: BigInt(0)},
    {type: "bn8", expected: new BN(0)},
    {type: "bool", expected: false},
    {type: {elementType: "bool", maxLength: 100}, expected: BitList.fromBitfield(Buffer.alloc(0), 0)},
    {type: {elementType: "bool", length: 100}, expected: BitVector.fromBitfield(Buffer.alloc(Math.ceil(100 / 8)), 100)},
    {type: {elementType: "byte", maxLength: 100}, expected: Buffer.alloc(0)},
    {type: {elementType: "byte", length: 100}, expected: Buffer.alloc(100)},
    {type: "bytes2", expected: Buffer.alloc(2)},
    {type: {elementType: "uint16", maxLength: 100}, expected: []},
    {type: ArrayObject, expected: {v: []}},
  ];
  for (const {type, expected} of testCases) {
    it(`should correctly get the defaultValue for ${stringifyType(type)}`, () => {
      const actual = defaultValue(type);
      expect(equals(actual, expected, type));
    });
  }
});
