import {describe, it} from "vitest";
import {Bucket as BeaconBucket} from "../../../beacon-node/src/db/buckets.js";
import {Bucket as ValidatorBucket} from "../../../validator/src/buckets.js";

describe("no db bucket overlap", () => {
  it("beacon and validator dn buckets do not overlap", () => {
    const beaconBucketValues = Object.values(BeaconBucket).filter(Number.isInteger) as number[];
    const validatorBucketValues = Object.values(ValidatorBucket).filter(Number.isInteger) as number[];

    for (const bucket of beaconBucketValues) {
      if (validatorBucketValues.includes(bucket)) {
        throw Error(`db bucket value ${bucket} present in both beacon and validator db schemas`);
      }
    }
  });
});
