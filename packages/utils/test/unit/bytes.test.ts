import {describe, it, expect} from "vitest";
import {intToBytes, bytesToInt, toHex, fromHex, toHexString} from "../../src/index.js";

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
      expect(intToBytes(input[0], input[1])).toEqual(output);
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
      expect(bytesToInt(input)).toBe(output);
    });
  }
});

describe("toHex", () => {
  const testCases: {input: Buffer | Uint8Array | string; output: string}[] = [
    {input: Buffer.from("Hello, World!", "utf-8"), output: "0x48656c6c6f2c20576f726c6421"},
    {input: new Uint8Array([72, 101, 108, 108, 111]), output: "0x48656c6c6f"},
    {input: Buffer.from([72, 101, 108, 108, 111]), output: "0x48656c6c6f"},
    {input: Buffer.from([]), output: "0x"},
  ];
  for (const {input, output} of testCases) {
    it(`should convert Uint8Array to hex string ${output}`, () => {
      expect(toHex(input)).toBe(output);
    });
  }
});

describe("fromHex", () => {
  const testCases: {input: string; output: Buffer | Uint8Array}[] = [
    {
      input: "0x48656c6c6f2c20576f726c6421",
      output: new Uint8Array([72, 101, 108, 108, 111, 44, 32, 87, 111, 114, 108, 100, 33]),
    },
    {
      input: "48656c6c6f2c20576f726c6421",
      output: new Uint8Array([72, 101, 108, 108, 111, 44, 32, 87, 111, 114, 108, 100, 33]),
    },
    {input: "0x", output: new Uint8Array([])},
  ];

  for (const {input, output} of testCases) {
    it(`should convert hex string ${input} to Uint8Array`, () => {
      expect(fromHex(input)).toEqual(output);
    });
  }
});

describe("toHexString", () => {
  const testCases: {input: Uint8Array; output: string}[] = [
    {input: new Uint8Array([1, 2, 3]), output: "0x010203"},
    {input: new Uint8Array([72, 101, 108, 108, 111]), output: "0x48656c6c6f"},
    {input: new Uint8Array([]), output: "0x"},
    {input: new Uint8Array([0, 0, 0, 0]), output: "0x00000000"},
    {input: new Uint8Array([15, 255, 16, 0, 127]), output: "0x0fff10007f"},
    {input: new Uint8Array(5).fill(255), output: "0x" + "ff".repeat(5)},
  ];

  for (const {input, output} of testCases) {
    it(`should convert Uint8Array to hex string ${output}`, () => {
      expect(toHexString(input)).toBe(output);
    });
  }
});
