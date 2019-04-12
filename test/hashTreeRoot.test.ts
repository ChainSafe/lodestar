import { assert } from "chai";

import BN from "bn.js";

import {
  SerializableValue,
  Type,
} from "../src/types";

import { hashTreeRoot } from "../src/hashTreeRoot";

import {
  ArrayObject,
  OuterObject,
  SimpleObject,
} from "./objects";

import { stringifyType } from "./utils";

describe("hashTreeRoot", () => {
  const testCases: {
    value: SerializableValue;
    type: any;
    expected: string;
  }[] = [
    {value: true, type: "bool", expected: ""},
    {value: false, type: "bool", expected: ""},
    {value: 0, type: "uint8", expected: ""},
    {value: 1, type: "uint8", expected: ""},
    {value: 255, type: "uint8", expected: ""},
    {value: 2**8, type: "uint16", expected: ""},
    {value: 2**12-1, type: "uint16", expected: ""},
    {value: 2**12, type: "uint16", expected: ""},
    {value: 2**16-1, type: "uint16", expected: ""},
    {value: 2**16, type: "uint32", expected: ""},
    {value: 2**28-1, type: "uint32", expected: ""},
    {value: 2**28, type: "uint32", expected: ""},
    {value: 2**32-1, type: "uint32", expected: ""},
    {value: 1, type: {type: Type.uint, byteLength: 8, offset: 2**32, useNumber: true}, expected: ""},
    {value: 2**32, type: "uint64", expected: ""},
    {value: 2**52-1, type: "uint64", expected: ""},
    {value: 2**32, type: "number64", expected: hashTreeRoot(2**32, "uint64").toString('hex')},
    {value: 2**52-1, type: "number64", expected: hashTreeRoot(2**52-1, "uint64").toString('hex')},
    {value: new BN("01", 16), type: "uint64", expected: ""},
    {value: new BN("1000000000000000", 16), type: "uint64", expected: ""},
    {value: new BN("ffffffffffffffff", 16), type: "uint64", expected: ""},
    {value: new BN("ffffffffffffffffffffffffffffffff", 16), type: "uint128", expected: ""},
    {value: new BN("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", 16), type: "uint256", expected: ""},
    {value: Buffer.from("deadbeef", "hex"), type: "bytes4", expected: ""},
    {value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"), type: "bytes32", expected: ""},
    {value: Buffer.from("deadbeef", "hex"), type: "bytes", expected: ""},
    {value: Buffer.from("deadbeef", "hex"), type: ["byte", 4], expected: ""},
    {value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"), type: ["byte", 16], expected: ""},
    {value: Buffer.from("deadbeef", "hex"), type: ["byte"], expected: ""},
    {value: {b:0,a:0}, type: SimpleObject, expected: ""},
    {value: {b:2,a:1}, type: SimpleObject, expected: ""},
    {value: {v:3, subV:{v:6}}, type: OuterObject, expected: ""},
    {value: {v: [{b:2,a:1}, {b:4,a:3}]}, type: ArrayObject, expected: ""},
    {value: [{v:3, subV:{v:6}}, {v:5, subV:{v:7}}], type: [OuterObject], expected: ""},
    {value: [], type: ["bool"], expected: ""},
    {value: [], type: [OuterObject], expected: ""},
  ];
  for (const {value, type, expected} of testCases) {
    it(`should correctly hash ${stringifyType(type)}`, () => {
      const actual = hashTreeRoot(value, type).toString('hex');
      assert(actual);
    });
  }

  const failCases: {
    value: SerializableValue;
    type: any;
    reason: string;
  }[] = [
    {value: 1, type: "foo", reason: "Invalid type"},
    {value: 1, type: "bar", reason: "Invalid type"},
  ];
  for (const {value, type, reason} of failCases) {
    it(`should throw an error for ${stringifyType(type)}: ${reason}`, () => {
      assert.throws(() => hashTreeRoot(value, type));
    });
  }
});

