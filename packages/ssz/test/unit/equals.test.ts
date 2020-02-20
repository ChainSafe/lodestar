import {expect} from "chai";
import {describe, it} from "mocha";

import {booleanType, byteType, ContainerType} from "../../src";
import {
  ArrayObject, ArrayObject2, bigint16Type, bigint64Type, bigint128Type, bigint256Type, bitList100Type, bitVector100Type, byteVector100Type,
  bytes2Type, bytes8Type, bytes32Type,
  number16Type, number32Type, number64Type, number16Vector6Type, number16List100Type, OuterObject, SimpleObject
} from "./objects";

describe("equals", () => {
  const testCases: {
    type: any;
    value1: any;
    value2: any;
    expected: boolean;
  }[] = [
    {value1: 1, value2: 1, type: byteType, expected: true},
    {value1: 0, value2: 1, type: byteType, expected: false},
    {value1: 0, value2: 1, type: byteType, expected: false},
    {value1: 0, value2: 1, type: byteType, expected: false},
    {value1: Infinity, value2: Infinity, type: byteType, expected: true},
    {value1: 1000n, value2: 1000n, type: bigint16Type, expected: true},
    {value1: true, value2: true, type: booleanType, expected: true},
    {value1: false, value2: false, type: booleanType, expected: true},
    {value1: false, value2: true, type: booleanType, expected: false},
    {value1: Buffer.from("abcd", "hex"), value2: Buffer.from("abcd", "hex"), type: bytes2Type, expected: true},
    {value1: Buffer.from("bbcd", "hex"), value2: Buffer.from("abcd", "hex"), type: bytes2Type, expected: false},
    {
      value1: [0, 1, 2, 3, 4, 5],
      value2: [0, 1, 2, 3, 4, 5],
      type: number16List100Type,
      expected: true
    },
    {
      value1: [0, 1, 2, 3, 4, 6],
      value2: [0, 1, 2, 3, 4, 5],
      type: number16List100Type,
      expected: false
    },
    {
      value1: {v: [{b: 2, a: 1}, {b: 4, a: 3}]},
      value2: {v: [{b: 2, a: 1}, {b: 4, a: 3}]},
      type: ArrayObject,
      expected: true
    },
    {
      value1: {v: [{a: 1, b: 2}, {b: 4, a: 3}]},
      value2: {v: [{b: 2, a: 1}, {b: 4, a: 3}]},
      type: ArrayObject,
      expected: true
    },
    {
      value1: {v: [{b: 4, a: 1}, {b: 4, a: 3}]},
      value2: {v: [{b: 2, a: 1}, {b: 4, a: 3}]},
      type: ArrayObject,
      expected: false
    },
  ];
  for (const {type, value1, value2, expected} of testCases) {
    it(`should correctly perform equal for ${type}`, () => {
      const actual = type.equals(value1, value2);
      expect(actual).to.equal(expected);
    });
  }
});
