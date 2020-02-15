import {expect} from "chai";
import {describe, it} from "mocha";
import {booleanType, byteType} from "../../src";
import {ArrayObject, bigint16Type, bytes2Type, number16Type, number16Vector6Type, number16List100Type} from "./objects";

describe("clone", () => {
  const testCases: {
    value: any;
    type: any;
    expected: boolean;
  }[] = [
    {value: 1, type: byteType, expected: true},
    {value: Infinity, type: byteType, expected: true},
    {value: 1000n, type: bigint16Type, expected: true},
    {value: true, type: booleanType, expected: true},
    {value: false, type: booleanType, expected: true},
    {value: Buffer.from("abcd", "hex"), type: bytes2Type, expected: true},
    {value: [0,1,2,3,4,5], type: number16List100Type, expected: true},
    {value: [0,1,2,3,4,5], type: number16Vector6Type, expected: true},
    {value: {v:[{b:2,a:1},{b:4,a:3}]}, type: ArrayObject, expected: true},
    {value: {v:[{a:1,b:2},{b:4,a:3}]}, type: ArrayObject, expected: true},
  ];
  for (const {type, value} of testCases) {
    it(`should correctly perform clone for ${type}`, () => {
      const actual = type.clone(value);
      expect(type.equals(actual, value));
    });
  }
});
