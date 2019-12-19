import {expect} from "chai";

import {equals} from "../../src";
import {describe, it} from "mocha";
import {ArrayObject,} from "./objects";

import {stringifyType} from "./utils";

describe("equals", () => {
  const testCases: {
    type: any;
    value1: any;
    value2: any;
    expected: boolean;
  }[] = [
    {value1: 1, value2: 1, type: "number8", expected: true},
    {value1: 0, value2: 1, type: "number8", expected: false},
    {value1: 0, value2: 1, type: "number8", expected: false},
    {value1: 0, value2: 1, type: "number8", expected: false},
    {value1: Infinity, value2: Infinity, type: "number8", expected: true},
    {value1: 1000n, value2: 1000n, type: "bigint16", expected: true},
    {value1: true, value2: true, type: "bool", expected: true},
    {value1: false, value2: false, type: "bool", expected: true},
    {value1: false, value2: true, type: "bool", expected: false},
    {
      value1: Buffer.from("abcd", "hex"),
      value2: Buffer.from("abcd", "hex"),
      type: {elementType: "byte", maxLength: 100},
      expected: true
    },
    {value1: Buffer.from("abcd", "hex"), value2: Buffer.from("abcd", "hex"), type: "bytes2", expected: true},
    {value1: Buffer.from("bbcd", "hex"), value2: Buffer.from("abcd", "hex"), type: "bytes2", expected: false},
    {
      value1: [0, 1, 2, 3, 4, 5],
      value2: [0, 1, 2, 3, 4, 5],
      type: {elementType: "number16", maxLength: 100},
      expected: true
    },
    {
      value1: [0, 1, 2, 3, 4, 6],
      value2: [0, 1, 2, 3, 4, 5],
      type: {elementType: "number16", maxLength: 100},
      expected: false
    },
    {
      value1: [0, 1, 2, 3, 4, 5],
      value2: [0, 1, 2, 3, 4, 5],
      type: {elementType: "number16", length: 6},
      expected: true
    },
    {
      value1: [0, 1, 2, 3, 4, 6],
      value2: [0, 1, 2, 3, 4, 5],
      type: {elementType: "number16", length: 6},
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
    it(`should correctly perform equal for ${stringifyType(type)}`, () => {
      const actual = equals(type, value1, value2);
      expect(actual).to.equal(expected);
    });
  }
});
