import {describe, it, expect} from "vitest";
import {intToBytes} from "@lodestar/utils";
import {BUCKET_LENGTH, encodeKey} from "../../src/index.js";

describe("encodeKey", () => {
  const bucket = 1;
  const testCases = [
    {input: {bucket, key: Buffer.from([0, 0, 0, 1])}, type: "Buffer"},
    {input: {bucket, key: Buffer.from([0, 1, 0, 1])}, type: "Buffer"},
    {input: {bucket, key: 5}, type: "number"},
    {input: {bucket, key: BigInt(5)}, type: "number"},
    {input: {bucket, key: "test"}, type: "string"},
  ];
  for (const {
    input: {bucket, key},
    type,
  } of testCases) {
    it(`should properly encode ${type}`, () => {
      let expected;
      if (type === "Buffer") {
        expected = Buffer.concat([intToBytes(bucket, BUCKET_LENGTH, "le"), key as Uint8Array]);
      } else if (typeof key === "string") {
        expected = Buffer.concat([intToBytes(bucket, BUCKET_LENGTH, "le"), Buffer.from(key)]);
      } else if (typeof key === "number" || typeof key === "bigint") {
        expected = Buffer.concat([intToBytes(bucket, BUCKET_LENGTH, "le"), intToBytes(BigInt(key), 8, "be")]);
      }
      const actual = encodeKey(bucket, key);
      expect(actual).toEqual(expected);
    });
  }
});
