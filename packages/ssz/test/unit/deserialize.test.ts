import {assert} from "chai";
import BN from "bn.js";

import {describe, it} from "mocha";
import {AnySSZType, SerializableValue} from "@chainsafe/ssz-type-schema";

import {ArrayObject, OuterObject, SimpleObject,} from "./objects";

import {stringifyType} from "./utils";
import {serialize, deserialize} from "../../src";

describe("deserialize", () => {

  const testCases: {
    value: string;
    type: any;
    expected: SerializableValue;
  }[] = [
    {value: "01", type: "bool", expected: true},
    {value: "00", type: "bool", expected: false},
    {value: "00", type: "uint8", expected: 0},
    {value: "01", type: "uint8", expected: 1},
    {value: "ff", type: "uint8", expected: 255},
    {value: "0001", type: "uint16", expected: 2**8},
    {value: "ff0f", type: "uint16", expected: 2**12-1},
    {value: "0010", type: "uint16", expected: 2**12},
    {value: "ffff", type: "uint16", expected: 2**16-1},
    {value: "00000100", type: "uint32", expected: 2**16},
    {value: "ffffff0f", type: "uint32", expected: 2**28-1},
    {value: "00000010", type: "uint32", expected: 2**28},
    {value: "ffffffff", type: "uint32", expected: 2**32-1},
    {value: "0000000001000000", type: "uint64", expected: 2n**32n},
    {value: "ffffffffffff0f00", type: "uint64", expected: 2n**52n-1n},
    {value: "0100000000000000", type: "uint64", expected: 0x01n},
    {value: "0100000000000000", type: "bn64", expected: new BN(1)},
    {value: "0000000000000010", type: "uint64", expected: 0x1000000000000000n},
    {value: "ffffffffffffffff", type: "uint64", expected: 0xffffffffffffffffn},
    {
      value: "ffffffffffffffffffffffffffffffff",
      type: "uint128",
      expected: 0xffffffffffffffffffffffffffffffffn
    },
    {
      value: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      type: "uint256",
      expected: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn
    },
    {value: "0000000001000000", type: "number64", expected: 2**32},
    {value: "ffffffffffff0f00", type: "number64", expected: 2**52-1},
    {value: "ffffffffffffffff", type: "number64", expected: Infinity},
    {value: "deadbeefdeadbeef", type: "bytes8", expected: Buffer.from("deadbeefdeadbeef", "hex")},
    {
      value: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      type: "bytes32",
      expected: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "hex")
    },
    {value: "deadbeef", type: {elementType: "byte", maxLength: 100}, expected: Buffer.from("deadbeef", "hex")},
    {
      value: "deadbeefdeadbeef",
      type: {elementType: "byte", length: 8},
      expected: Buffer.from("deadbeefdeadbeef", "hex")
    },
    {
      value: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      type: {elementType: "byte", length: 32},
      expected: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "hex")
    },
    {value: "deadbeef", type: {elementType: "byte", maxLength: 100}, expected: Buffer.from("deadbeef", "hex")},
    {value: "000000", type: SimpleObject, expected: {b:0,a:0}},
    {value: "020001", type: SimpleObject, expected: {b:2,a:1}},
    {value: "030600", type: OuterObject, expected: {v:3, subV:{v:6}}},
    {value: "04000000020001040003", type: ArrayObject, expected: {v: [{b:2,a:1}, {b:4,a:3}]}},
    {
      value: "030600050700",
      type: {elementType: OuterObject, maxLength: 100},
      expected: [{v:3, subV:{v:6}}, {v:5, subV:{v:7}}]
    },
  ];
  for (const {value, type, expected} of testCases) {
    it(`should correctly deserialize ${stringifyType(type)}`, () => {
      const actual = deserialize(Buffer.from(value, "hex"), type);
      if (BN.isBN(expected)) {
        assert((actual as BN).eq(expected), `actual: ${actual}, expected: ${expected}`);
      } else if (typeof expected === "bigint") {
        assert(expected ===  actual, `actual: ${actual}, expected: ${expected}`);
      } else {
        assert.deepEqual(actual, expected);
      }
    });
  }

  const failCases: {
    value: string;
    type: any;
    reason: string;
  }[] = [
    {value: "01", type: "foo", reason: "Invalid type"},
    {value: "01", type: "bar", reason: "Invalid type"},
  ];
  for (const {value, type, reason} of failCases) {
    it(`should throw an error for ${stringifyType(type)}: ${reason}`, () => {
      assert.throws(() => deserialize(Buffer.from(value, "hex"), type));
    });
  }
});

interface ITestType {
  foo: number;
  bar: boolean;
}

describe("type inference", () => {
  it("should detect the return type", () => {
    const testType: AnySSZType<ITestType> = {
      fields: [
        ["foo", "uint8"],
        ["bar", "bool"],
      ],
    };
    const input: ITestType = {
      foo: 1,
      bar: true,
    };
    const bytes = serialize(input, testType);
    const output = deserialize(bytes, testType);
    assert(output.bar == true);
  });
});
