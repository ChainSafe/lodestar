import {assert} from "chai";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {Bucket, encodeKey} from "../../src/schema.js";
import {BUCKET_LENGTH} from "../../src/index.js";

describe("encodeKey", () => {
  const testCases = [
    {
      input: {bucket: Bucket.allForks_block, key: Buffer.from([0, 0, 0, 1])},
      type: "Buffer",
    },
    {
      input: {bucket: Bucket.allForks_block, key: Buffer.from([0, 1, 0, 1])},
      type: "Buffer",
    },
    {input: {bucket: Bucket.allForks_block, key: 5}, type: "number"},
    {input: {bucket: Bucket.allForks_block, key: BigInt(5)}, type: "number"},
    {input: {bucket: Bucket.allForks_block, key: "test"}, type: "string"},
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
      assert.deepEqual(actual, expected);
    });
  }
});
