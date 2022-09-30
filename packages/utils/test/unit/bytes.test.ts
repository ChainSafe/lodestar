import "../setup.js";
import {assert, expect} from "chai";
import {intToBytes, bytesToInt} from "../../src/index.js";

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
