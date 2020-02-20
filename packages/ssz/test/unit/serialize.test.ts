import {assert} from "chai";
import {describe, it} from "mocha";

import {booleanType, byteType, ContainerType, ListType} from "../../src";
import {
  ArrayObject, ArrayObject2, bigint16Type, bigint64Type, bigint128Type, bigint256Type, bitList100Type, bitVector100Type, byteVector100Type,
  bytes2Type, bytes4Type, bytes8Type, bytes32Type,
  number16Type, number32Type, number64Type, number16Vector6Type, number16List100Type, OuterObject, SimpleObject
} from "./objects";

describe("serialize", () => {
  const testCases: {
    value: any,
    type: any;
    expected: string;
  }[] = [
    {value: true, type: booleanType, expected: "01"},
    {value: false, type: booleanType, expected: "00"},
    {value: 0, type: byteType, expected: "00"},
    {value: 1, type: byteType, expected: "01"},
    {value: 255, type: byteType, expected: "ff"},
    {value: 2**8, type: number16Type, expected: "0001"},
    {value: 2**12-1, type: number16Type, expected: "ff0f"},
    {value: 2**12, type: number16Type, expected: "0010"},
    {value: 2**16-1, type: number16Type, expected: "ffff"},
    {value: 2**16, type: number32Type, expected: "00000100"},
    {value: 2**28-1, type: number32Type, expected: "ffffff0f"},
    {value: 2**28, type: number32Type, expected: "00000010"},
    {value: 2**32-1, type: number32Type, expected: "ffffffff"},
    {value: 2**32, type: number64Type, expected: "0000000001000000"},
    {value: 2**52-1, type: number64Type, expected: "ffffffffffff0f00"},
    {value: 2**32, type: number64Type, expected: "0000000001000000"},
    {value: 2**52-1, type: number64Type, expected: "ffffffffffff0f00"},
    {value: Infinity, type: number64Type, expected: "ffffffffffffffff"},
    {value: 0x01n, type: bigint64Type, expected: "0100000000000000"},
    {value: 0x1000000000000000n, type: bigint64Type, expected: "0000000000000010"},
    {value: 0xffffffffffffffffn, type: bigint64Type, expected: "ffffffffffffffff"},
    {
      value: 0xffffffffffffffffffffffffffffffffn,
      type: bigint128Type, expected: "ffffffffffffffffffffffffffffffff"
    },
    {
      value: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
      type: bigint256Type, expected: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    },
    {value: Buffer.from("deadbeef", "hex"), type: bytes4Type, expected: "deadbeef"},
    {value: Buffer.from("deadbeef", "hex"), type: bytes4Type, expected: "deadbeef"},
    {value: {b:0,a:0}, type: SimpleObject, expected: "000000"},
    {value: {b:2,a:1}, type: SimpleObject, expected: "020001"},
    {value: {v:3, subV:{v:6}}, type: OuterObject, expected: "030600"},
    {value: {v: [{b:2,a:1}, {b:4,a:3}]}, type: ArrayObject, expected: "04000000020001040003"},
    {
      value: [{v:3, subV:{v:6}}, {v:5, subV:{v:7}}],
      type: ArrayObject2,
      expected: "030600050700"
    },
    {value: [], type: ArrayObject2, expected: ""},
  ];
  for (const {type, value, expected} of testCases) {
    it(`should correctly serialize ${type}`, () => {
      const actual = Buffer.from(type.serialize(value)).toString("hex");
      assert.equal(actual, expected);
    });
  }
});

