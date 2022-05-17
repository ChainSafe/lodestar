import {BitArray} from "@chainsafe/ssz";

export enum IntersectResult {
  Equal,
  Superset,
  Subset,
  Exclude,
  Diff,
}

/**
 * For each byte check if a includes b,
 * | a        | b        | result       |
 * | 00001111 | 00001111 | A equals B   |
 * | 00001111 | 00000011 | A superset B |
 * | 00000011 | 00001111 | A subset B   |
 * | 11110000 | 00001111 | A exclude B  |
 * | 11111100 | 00111111 | A diff B     |
 *
 * For all bytes in BitArray:
 * - equals = (equals)[]
 * - excludes = (excludes)[]
 * - superset = (Superset | equal)[]
 * - subset = (Subset | equal)[]
 * - diff = (diff | *)[]
 */
export function intersectBitArrays(aBA: BitArray, bBA: BitArray): IntersectResult {
  const aUA = aBA.uint8Array;
  const bUA = bBA.uint8Array;
  const len = aBA.uint8Array.length;

  let someExcludes = false;
  let someSuperset = false;
  let someSubset = false;

  for (let i = 0; i < len; i++) {
    const a = aUA[i];
    const b = bUA[i];

    if (a === b) {
      // A equals B
    } else if ((a & b) === 0) {
      // A excludes B
      someExcludes = true;
    } else if ((a & b) === a) {
      // A superset B
      if (someSubset) return IntersectResult.Diff;
      someSuperset = true;
    } else if ((a & b) === b) {
      // A subset B
      if (someSuperset) return IntersectResult.Diff;
      someSubset = true;
    } else {
      // A diff B
      return IntersectResult.Diff;
    }
  }

  if (!someExcludes && !someSuperset && !someSubset) return IntersectResult.Equal;
  if (someExcludes && !someSuperset && !someSubset) return IntersectResult.Exclude;
  if (!someExcludes && someSuperset && !someSubset) return IntersectResult.Superset;
  if (!someExcludes && !someSuperset && someSubset) return IntersectResult.Subset;
  else return IntersectResult.Diff;
}
