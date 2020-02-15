import {assert} from "chai";
import {describe, it} from "mocha";

import {booleanType, byteType, ContainerType} from "../../src";
import {
  ArrayObject, ArrayObject2, bigint16Type, bigint64Type, bigint128Type, bigint256Type, bitList100Type, bitVector100Type, byteVector100Type,
  bytes2Type, bytes8Type, bytes32Type,
  number16Type, number32Type, number64Type, number16Vector6Type, number16List100Type, OuterObject, SimpleObject
} from "./objects";


describe("deserialize", () => {

  const testCases: {
    value: string;
    type: any;
    expected: any;
  }[] = [
    {value: "01", type: booleanType, expected: true},
    {value: "00", type: booleanType, expected: false},
    {value: "00", type: byteType, expected: 0},
    {value: "01", type: byteType, expected: 1},
    {value: "ff", type: byteType, expected: 255},
    {value: "0001", type: number16Type, expected: 2**8},
    {value: "ff0f", type: number16Type, expected: 2**12-1},
    {value: "0010", type: number16Type, expected: 2**12},
    {value: "ffff", type: number16Type, expected: 2**16-1},
    {value: "00000100", type: number32Type, expected: 2**16},
    {value: "ffffff0f", type: number32Type, expected: 2**28-1},
    {value: "00000010", type: number32Type, expected: 2**28},
    {value: "ffffffff", type: number32Type, expected: 2**32-1},
    {value: "0000000001000000", type: bigint64Type, expected: 2n**32n},
    {value: "ffffffffffff0f00", type: bigint64Type, expected: 2n**52n-1n},
    {value: "0100000000000000", type: bigint64Type, expected: 0x01n},
    {value: "0000000000000010", type: bigint64Type, expected: 0x1000000000000000n},
    {value: "ffffffffffffffff", type: bigint64Type, expected: 0xffffffffffffffffn},
    {
      value: "ffffffffffffffffffffffffffffffff",
      type: bigint128Type,
      expected: 0xffffffffffffffffffffffffffffffffn
    },
    {
      value: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      type: bigint256Type,
      expected: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn
    },
    {value: "0000000001000000", type: number64Type, expected: 2**32},
    {value: "ffffffffffff0f00", type: number64Type, expected: 2**52-1},
    {value: "ffffffffffffffff", type: number64Type, expected: Infinity},
    {value: "deadbeefdeadbeef", type: bytes8Type, expected: Buffer.from("deadbeefdeadbeef", "hex")},
    {
      value: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      type: bytes32Type,
      expected: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "hex")
    },
    {value: "000000", type: SimpleObject, expected: {b:0,a:0}},
    {value: "020001", type: SimpleObject, expected: {b:2,a:1}},
    {value: "030600", type: OuterObject, expected: {v:3, subV:{v:6}}},
    {value: "04000000020001040003", type: ArrayObject, expected: {v: [{b:2,a:1}, {b:4,a:3}]}},
    {
      value: "030600050700",
      type: ArrayObject2,
      expected: [{v:3, subV:{v:6}}, {v:5, subV:{v:7}}]
    },
  ];
  for (const {type, value, expected} of testCases) {
    it(`should correctly deserialize ${type}`, () => {
      const actual = type.deserialize(Buffer.from(value, "hex"));
      assert.deepEqual(actual, expected);
    });
  }
});

interface ITestType {
  foo: number;
  bar: boolean;
}

describe("type inference", () => {
  it("should detect the return type", () => {
    const testType = new ContainerType<ITestType>({
      fields: {
        foo: byteType,
        bar: booleanType,
      }
    });

    const input: ITestType = {
      foo: 1,
      bar: true,
    };
    const bytes = testType.serialize(input);
    const output = testType.deserialize(bytes);
    assert(output.bar == true);
  });
});
