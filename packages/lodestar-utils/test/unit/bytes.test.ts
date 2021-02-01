import {assert, expect} from "chai";
import {intToBytes, bytesToInt, fromHex, toHex} from "../../src";

describe("intToBytes", () => {
  const zeroedArray = (length: number): number[] => Array.from({length}, () => 0);
  const testCases: {input: [bigint | number, number]; output: Buffer}[] = [
    {input: [255, 1], output: Buffer.from([255])},
    {input: [1, 4], output: Buffer.from([1, 0, 0, 0])},
    {input: [BigInt(255), 1], output: Buffer.from([255])},
    {input: [65535, 2], output: Buffer.from([255, 255])},
    {input: [BigInt(65535), 2], output: Buffer.from([255, 255])},
    {input: [16777215, 3], output: Buffer.from([255, 255, 255])},
    {input: [BigInt(16777215), 3], output: Buffer.from([255, 255, 255])},
    {input: [4294967295, 4], output: Buffer.from([255, 255, 255, 255])},
    {input: [BigInt(4294967295), 4], output: Buffer.from([255, 255, 255, 255])},
    {input: [65535, 8], output: Buffer.from([255, 255, ...zeroedArray(8 - 2)])},
    {input: [BigInt(65535), 8], output: Buffer.from([255, 255, ...zeroedArray(8 - 2)])},
    {input: [65535, 32], output: Buffer.from([255, 255, ...zeroedArray(32 - 2)])},
    {input: [BigInt(65535), 32], output: Buffer.from([255, 255, ...zeroedArray(32 - 2)])},
    {input: [65535, 48], output: Buffer.from([255, 255, ...zeroedArray(48 - 2)])},
    {input: [BigInt(65535), 48], output: Buffer.from([255, 255, ...zeroedArray(48 - 2)])},
    {input: [65535, 96], output: Buffer.from([255, 255, ...zeroedArray(96 - 2)])},
    {input: [BigInt(65535), 96], output: Buffer.from([255, 255, ...zeroedArray(96 - 2)])},
  ];
  for (const {input, output} of testCases) {
    const type = typeof input;
    const length = input[1];
    it(`should correctly serialize ${type} to bytes length ${length}`, () => {
      assert(intToBytes(input[0], input[1]).equals(output));
    });
  }
});

describe("bytesToInt", () => {
  const testCases: {input: Buffer; output: number}[] = [
    {input: Buffer.from([3]), output: 3},
    {input: Buffer.from([20, 0]), output: 20},
    {input: Buffer.from([3, 20]), output: 5123},
    {input: Buffer.from([255, 255]), output: 65535},
    {input: Buffer.from([255, 255, 255]), output: 16777215},
    {input: Buffer.from([255, 255, 255, 255]), output: 4294967295},
  ];
  for (const {input, output} of testCases) {
    it(`should produce ${output}`, () => {
      expect(bytesToInt(input)).to.be.equal(output);
    });
  }
});

describe("fromHex", function () {
  it("should work with 0x prefix", function () {
    const buf = Buffer.alloc(32, 354);
    expect(fromHex("0x" + buf.toString("hex"))).to.be.deep.equal(buf);
  });
  it("should work without 0x prefix", function () {
    const buf = Buffer.alloc(32, 354);
    expect(fromHex(buf.toString("hex"))).to.be.deep.equal(buf);
  });
});

describe("toHex", function () {
  it("should work from buffer", function () {
    const buf = Buffer.alloc(32, 354);
    expect(toHex(buf).length).to.be.equal(66);
  });
  it("should work from uint8Array", function () {
    const buf = Buffer.alloc(32, 354);
    const array = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    expect(toHex(array).length).to.be.equal(66);
  });
  it("should work from array", function () {
    const arr = [0, 0, 1];
    expect(toHex(arr)).to.be.equal("0x000001");
  });
  it("should work round trip", function () {
    const hex = "0x2a3b";
    expect(toHex(fromHex(hex))).to.be.equal(hex);
  });
});
