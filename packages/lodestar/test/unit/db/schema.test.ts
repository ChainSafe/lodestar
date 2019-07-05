import {assert} from "chai";
import BN from "bn.js";

import {Bucket, encodeKey} from "../../../src/db/schema";


describe("encodeKey", () => {
  const testCases = [
    {input: {bucket: Bucket.attestation, key: Buffer.from([0,0,0,1])}, type: "Buffer"},
    {input: {bucket: Bucket.attestation, key: Buffer.from([0,1,0,1])}, type: "Buffer"},
    {input: {bucket: Bucket.attestation, key: 5}, type: "number"},
    {input: {bucket: Bucket.attestation, key: new BN(5)}, type: "number"},
    {input: {bucket: Bucket.attestation, key: "test"}, type: "string"},
  ];
  for (const {input: {bucket, key}, type} of testCases) {
    it(`should properly encode ${type}`, () => {
      let expected;
      if (type === "Buffer") {
        expected = Buffer.concat([Buffer.from([bucket]), key as Buffer]);
      } else if (typeof key === "string") {
        expected = Buffer.concat([Buffer.from([bucket]), Buffer.from(key)]);
      } else if (typeof key === "number") {
        expected = Buffer.concat([Buffer.from([bucket]), (new BN(key)).toArrayLike(Buffer, 'le', 8)]);
      } else if (BN.isBN(key)) {
        expected = Buffer.concat([Buffer.from([bucket]), key.toArrayLike(Buffer, 'le', 8)]);
      }
      const actual = encodeKey(bucket, key);
      assert.deepEqual(actual, expected);
    });
  }
});
