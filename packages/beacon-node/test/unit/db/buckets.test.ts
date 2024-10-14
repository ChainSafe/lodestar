import {describe, it} from "vitest";
import {Bucket} from "../../../src/db/buckets.js";

describe("db buckets", () => {
  it("sorted and unique", () => {
    let prevBucket = -1;

    for (const key of Object.keys(Bucket)) {
      if (Number.isNaN(parseInt(key))) {
        const bucket = (Bucket as unknown as Record<string, number>)[key];
        if (bucket < prevBucket) {
          throw Error(`Bucket ${key} not sorted`);
        }
        if (bucket === prevBucket) {
          throw Error(`Bucket ${key}: ${bucket} duplicated`);
        }
        prevBucket = bucket;
      }
    }
  });
});
