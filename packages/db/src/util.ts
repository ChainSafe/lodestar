import {Bucket} from "./schema.js";

export function getBucketNameByValue<T extends Bucket>(enumValue: T): keyof typeof Bucket {
  const keys = Object.keys(Bucket).filter((x) => {
    if (isNaN(parseInt(x))) {
      return Bucket[x as keyof typeof Bucket] == enumValue;
    } else {
      return false;
    }
  }) as (keyof typeof Bucket)[];
  if (keys.length > 0) {
    return keys[0];
  }
  throw new Error("Missing bucket for value " + enumValue);
}
