import {assert} from "chai";

import BN from "bn.js";

import {
  serialize,
  SerializableValue,
  Type,
} from "../../src";

import {
  ArrayObject,
  OuterObject,
  SimpleObject,
} from "./objects";

import {stringifyType} from "./utils";

describe("serialize", () => {
  const testCases: {
    value: SerializableValue;
    type: any;
    expected: string;
  }[] = [
    {value: true, type: "bool", expected: "01"},
    {value: false, type: "bool", expected: "00"},
    {value: 0, type: "uint8", expected: "00"},
    {value: 1, type: "uint8", expected: "01"},
    {value: 255, type: "uint8", expected: "ff"},
    {value: 2**8, type: "uint16", expected: "0001"},
    {value: 2**12-1, type: "uint16", expected: "ff0f"},
    {value: 2**12, type: "uint16", expected: "0010"},
    {value: 2**16-1, type: "uint16", expected: "ffff"},
    {value: 2**16, type: "uint32", expected: "00000100"},
    {value: 2**28-1, type: "uint32", expected: "ffffff0f"},
    {value: 2**28, type: "uint32", expected: "00000010"},
    {value: 2**32-1, type: "uint32", expected: "ffffffff"},
    {value: 2**32, type: "uint64", expected: "0000000001000000"},
    {value: 2**52-1, type: "uint64", expected: "ffffffffffff0f00"},
    {value: 2**32, type: "number64", expected: "0000000001000000"},
    {value: 2**52-1, type: "number64", expected: "ffffffffffff0f00"},
    {value: Infinity, type: "number64", expected: "ffffffffffffffff"},
    {value: new BN("01", 16), type: "uint64", expected: "0100000000000000"},
    {value: new BN("1000000000000000", 16), type: "uint64", expected: "0000000000000010"},
    {value: new BN("ffffffffffffffff", 16), type: "uint64", expected: "ffffffffffffffff"},
    {value: new BN("ffffffffffffffffffffffffffffffff", 16), type: "uint128", expected: "ffffffffffffffffffffffffffffffff"},
    {value: new BN("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", 16), type: "uint256", expected: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"},
    {value: Buffer.from("deadbeef", "hex"), type: "bytes4", expected: "deadbeef"},
    {value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"), type: "bytes16", expected: "deadbeefdeadbeefdeadbeefdeadbeef"},
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", maxLength: 100}, expected: "deadbeef"},
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", length: 4}, expected: "deadbeef"},
    {value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"), type: {elementType: "byte", length: 16}, expected: "deadbeefdeadbeefdeadbeefdeadbeef"},
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", maxLength: 100}, expected: "deadbeef"},
    {value: {b:0,a:0}, type: SimpleObject, expected: "000000"},
    {value: {b:2,a:1}, type: SimpleObject, expected: "020001"},
    {value: {v:3, subV:{v:6}}, type: OuterObject, expected: "030600"},
    {value: {v: [{b:2,a:1}, {b:4,a:3}]}, type: ArrayObject, expected: "04000000020001040003"},
    {value: [{v:3, subV:{v:6}}, {v:5, subV:{v:7}}], type: {elementType: OuterObject, maxLength: 10}, expected: "030600050700"},
    {value: [], type: {elementType: OuterObject, maxLength: 10}, expected: ""},
  ];
  for (const {value, type, expected} of testCases) {
    it(`should correctly serialize ${stringifyType(type)}`, () => {
      const actual = serialize(value, type).toString('hex');
      assert.equal(actual, expected);
    });
  }

  const failCases: {
    value: SerializableValue;
    type: any;
    reason: string;
  }[] = [
    {value: 1, type: "foo", reason: "Invalid type"},
    {value: 1, type: "bar", reason: "Invalid type"},
    {value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"), type: "bytes32", reason: "invalid byte array length"},
  ];
  for (const {value, type, reason} of failCases) {
    it(`should throw an error for ${stringifyType(type)}: ${reason}`, () => {
      assert.throws(() => serialize(value, type));
    });
  }
});

