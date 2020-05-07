import {assert} from "chai";
import {intToBytes} from "@chainsafe/lodestar-utils";

import {Bucket, encodeKey} from "../../../src/db/api/schema";


describe("encodeKey", () => {
  const testCases = [
    {input: {bucket: Bucket.attestation, key: Buffer.from([0,0,0,1])}, type: "Buffer"},
    {input: {bucket: Bucket.attestation, key: Buffer.from([0,1,0,1])}, type: "Buffer"},
    {input: {bucket: Bucket.attestation, key: 5}, type: "number"},
    {input: {bucket: Bucket.attestation, key: 5n}, type: "number"},
    {input: {bucket: Bucket.attestation, key: "test"}, type: "string"},
  ];
  for (const {input: {bucket, key}, type} of testCases) {
    it(`should properly encode ${type}`, () => {
      let expected;
      if (type === "Buffer") {
        expected = Buffer.concat([Buffer.from([bucket]), key as Buffer]);
      } else if (typeof key === "string") {
        expected = Buffer.concat([Buffer.from([bucket]), Buffer.from(key)]);
      } else if (typeof key === "number" || typeof key === "bigint") {
        expected = Buffer.concat([Buffer.from([bucket]), Buffer.from(key.toString(10), "ascii")]);
      }
      const actual = encodeKey(bucket, key);
      assert.deepEqual(actual, expected);
    });
  }
});
