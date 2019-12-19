import {expect} from "chai";
import {describe, it} from "mocha";
import {clone, equals} from "../../src";
import {ArrayObject,} from "./objects";
import {stringifyType} from "./utils";

describe("clone", () => {
  const testCases: {
    value: any;
    type: any;
    expected: boolean;
  }[] = [
    {value: 1, type: "number8", expected: true},
    {value: Infinity, type: "number8", expected: true},
    {value: 1000n, type: "bigint16", expected: true},
    {value: true, type: "bool", expected: true},
    {value: false, type: "bool", expected: true},
    {value: Buffer.from("abcd", "hex"), type: {elementType: "byte", maxLength: 100}, expected: true},
    {value: Buffer.from("abcd", "hex"), type: "bytes2", expected: true},
    {value: [0,1,2,3,4,5], type: {elementType: "number16", maxLength: 100}, expected: true},
    {value: [0,1,2,3,4,5], type: {elementType: "number16", length: 6}, expected: true},
    {value: {v:[{b:2,a:1},{b:4,a:3}]}, type: ArrayObject, expected: true},
    {value: {v:[{a:1,b:2},{b:4,a:3}]}, type: ArrayObject, expected: true},
  ];
  for (const {type, value} of testCases) {
    it(`should correctly perform clone for ${stringifyType(type)}`, () => {
      const actual = clone(type, value);
      expect(equals(type, actual, value));
    });
  }
});
