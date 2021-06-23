import {Bucket} from ".";

export function getBucketNameByValue<T extends Bucket>(enumValue: T): keyof typeof Bucket | null {
  const keys = Object.keys(Bucket).filter((x) => {
    if (isNaN(parseInt(x))) {
      return Bucket[x as keyof typeof Bucket] == enumValue;
    } else {
      return false;
    }
  }) as (keyof typeof Bucket)[];
  return keys.length > 0 ? keys[0] : null;
}
