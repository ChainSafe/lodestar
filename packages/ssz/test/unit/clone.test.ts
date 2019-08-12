import BN from "bn.js";
import {expect} from "chai";

import {clone, equals} from "../../src";

import {
  ArrayObject,
} from "./objects";

import {stringifyType} from "./utils";

describe("clone", () => {
  const testCases: {
    value: any;
    type: any;
    expected: boolean;
  }[] = [
    {value: 1, type: "uint8", expected: true},
    {value: Infinity, type: "uint8", expected: true},
    {value: new BN(1000), type: "uint16", expected: true},
    {value: true, type: "bool", expected: true},
    {value: false, type: "bool", expected: true},
    {value: Buffer.from("abcd", "hex"), type: {elementType: "byte", maxLength: 100}, expected: true},
    {value: Buffer.from("abcd", "hex"), type: "bytes2", expected: true},
    {value: [0,1,2,3,4,5], type: {elementType: "uint16", maxLength: 100}, expected: true},
    {value: [0,1,2,3,4,5], type: {elementType: "uint16", length: 6}, expected: true},
    {value: {v:[{b:2,a:1},{b:4,a:3}]}, type: ArrayObject, expected: true},
    {value: {v:[{a:1,b:2},{b:4,a:3}]}, type: ArrayObject, expected: true},
  ];
  for (const {value, type, expected} of testCases) {
    it(`should correctly perform clone for ${stringifyType(type)}`, () => {
      const actual = clone(value, type);
      expect(equals(actual, value, type));
    });
  }
});
