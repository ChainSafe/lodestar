import {assert} from "chai";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {Bucket, encodeKey} from "../../src/schema";

describe("encodeKey", () => {
  const testCases = [
    {
      input: {bucket: Bucket.attestation, forkVersion: Buffer.alloc(8, 0), key: Buffer.from([0, 0, 0, 1])},
      type: "Buffer",
    },
    {
      input: {bucket: Bucket.attestation, forkVersion: Buffer.alloc(8, 1), key: Buffer.from([0, 1, 0, 1])},
      type: "Buffer",
    },
    {input: {bucket: Bucket.attestation, forkVersion: Buffer.alloc(8, 2), key: 5}, type: "number"},
    {input: {bucket: Bucket.attestation, forkVersion: Buffer.alloc(8, 3), key: BigInt(5)}, type: "number"},
    {input: {bucket: Bucket.attestation, forkVersion: Buffer.alloc(8, 4), key: "test"}, type: "string"},
  ];
  for (const {
    input: {bucket, forkVersion, key},
    type,
  } of testCases) {
    it(`should properly encode ${type}`, () => {
      let expected;
      if (type === "Buffer") {
        expected = Buffer.concat([Buffer.from([bucket]), forkVersion, key as Buffer]);
      } else if (typeof key === "string") {
        expected = Buffer.concat([Buffer.from([bucket]), forkVersion, Buffer.from(key)]);
      } else if (typeof key === "number" || typeof key === "bigint") {
        expected = Buffer.concat([Buffer.from([bucket]), forkVersion, intToBytes(BigInt(key), 8, "be")]);
      }
      const actual = encodeKey(bucket, forkVersion, key);
      assert.deepEqual(actual, expected);
    });
  }
});
