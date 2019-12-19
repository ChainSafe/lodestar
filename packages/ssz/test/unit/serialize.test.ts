import {assert} from "chai";
import {describe, it} from "mocha";

import {SerializableValue} from "@chainsafe/ssz-type-schema";
import BN from "bn.js";

import {ArrayObject, OuterObject, SimpleObject,} from "./objects";

import {stringifyType} from "./utils";
import {serialize} from "../../src";

describe("serialize", () => {
  const testCases: {
    value: SerializableValue;
    type: any;
    expected: string;
  }[] = [
    {value: true, type: "bool", expected: "01"},
    {value: false, type: "bool", expected: "00"},
    {value: 0, type: "number8", expected: "00"},
    {value: 1, type: "number8", expected: "01"},
    {value: 255, type: "number8", expected: "ff"},
    {value: 2**8, type: "number16", expected: "0001"},
    {value: 2**12-1, type: "number16", expected: "ff0f"},
    {value: 2**12, type: "number16", expected: "0010"},
    {value: 2**16-1, type: "number16", expected: "ffff"},
    {value: 2**16, type: "number32", expected: "00000100"},
    {value: 2**28-1, type: "number32", expected: "ffffff0f"},
    {value: 2**28, type: "number32", expected: "00000010"},
    {value: 2**32-1, type: "number32", expected: "ffffffff"},
    {value: 2**32, type: "number64", expected: "0000000001000000"},
    {value: 2**52-1, type: "number64", expected: "ffffffffffff0f00"},
    {value: 2**32, type: "number64", expected: "0000000001000000"},
    {value: 2**52-1, type: "number64", expected: "ffffffffffff0f00"},
    {value: Infinity, type: "number64", expected: "ffffffffffffffff"},
    {value: 0x01n, type: "bigint64", expected: "0100000000000000"},
    {value: new BN(1), type: "bn64", expected: "0100000000000000"},
    {value: new BN(1), type: "bn64", expected: "0100000000000000"},
    {value: 0x1000000000000000n, type: "bigint64", expected: "0000000000000010"},
    {value: 0xffffffffffffffffn, type: "bigint64", expected: "ffffffffffffffff"},
    {
      value: 0xffffffffffffffffffffffffffffffffn,
      type: "bigint128", expected: "ffffffffffffffffffffffffffffffff"
    },
    {
      value: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
      type: "bigint256", expected: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    },
    {value: Buffer.from("deadbeef", "hex"), type: "bytes4", expected: "deadbeef"},
    {
      value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"),
      type: "bytes16", expected: "deadbeefdeadbeefdeadbeefdeadbeef"
    },
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", maxLength: 100}, expected: "deadbeef"},
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", length: 4}, expected: "deadbeef"},
    {
      value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"),
      type: {elementType: "byte", length: 16}, expected: "deadbeefdeadbeefdeadbeefdeadbeef"
    },
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", maxLength: 100}, expected: "deadbeef"},
    {value: {b:0,a:0}, type: SimpleObject, expected: "000000"},
    {value: {b:2,a:1}, type: SimpleObject, expected: "020001"},
    {value: {v:3, subV:{v:6}}, type: OuterObject, expected: "030600"},
    {value: {v: [{b:2,a:1}, {b:4,a:3}]}, type: ArrayObject, expected: "04000000020001040003"},
    {
      value: [{v:3, subV:{v:6}}, {v:5, subV:{v:7}}],
      type: {elementType: OuterObject, maxLength: 10},
      expected: "030600050700"
    },
    {value: [], type: {elementType: OuterObject, maxLength: 10}, expected: ""},
  ];
  for (const {type, value, expected} of testCases) {
    it(`should correctly serialize ${stringifyType(type)}`, () => {
      const actual = serialize(type, value).toString("hex");
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
    {
      value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"),
      type: "bytes32",
      reason: "invalid byte array length"
    },
  ];
  for (const {type, value, reason} of failCases) {
    it(`should throw an error for ${stringifyType(type)}: ${reason}`, () => {
      assert.throws(() => serialize(type, value));
    });
  }
});

