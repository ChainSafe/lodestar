import {BitArray} from "@chainsafe/ssz";

export enum IntersectResult {
  Equal,
  /** All elements in set B are in set A  */
  Superset,
  /** All elements in set A are in set B  */
  Subset,
  /** Set A and set B do not share any elements */
  Exclusive,
  /** Set A and set B intersect but are not superset or subset */
  Intersect,
}

/**
 * For each byte check if a includes b,
 * | a        | b        | result        |
 * | -------- | -------- | ------------- |
 * | 00001111 | 00001111 | A equals B    |
 * | 00001111 | 00000011 | A superset B  |
 * | 00000011 | 00001111 | A subset B    |
 * | 11110000 | 00001111 | A exclude B   |
 * | 11111100 | 00111111 | A intersect B |
 *
 * For all bytes in BitArray:
 * - equals = MAYBE ONLY equals
 * - excludes = MUST ONLY equals
 * - superset = MUST superset MAYBE equal
 * - subset = MUST subset MAYBE equal
 * - intersect = any other condition
 */
export function intersectUint8Arrays(aUA: Uint8Array, bUA: Uint8Array): IntersectResult {
  const len = aUA.length;

  let someEquals = false;
  let someExcludes = false;
  let someSuperset = false;
  let someSubset = false;

  for (let i = 0; i < len; i++) {
    const a = aUA[i];
    const b = bUA[i];

    if (a === 0 && b === 0) {
      // zero, skip
    } else if (a === b) {
      // A equals B
      someEquals = true;
    } else if ((a & b) === 0) {
      // A excludes B
      someExcludes = true;
    } else if ((a & b) === b) {
      // A superset B
      if (someSubset) return IntersectResult.Intersect;
      someSuperset = true;
    } else if ((a & b) === a) {
      // A subset B
      if (someSuperset) return IntersectResult.Intersect;
      someSubset = true;
    } else {
      // A diff B
      return IntersectResult.Intersect;
    }
  }

  // equals = MAYBE ONLY equals
  if (!someExcludes && !someSuperset && !someSubset) return IntersectResult.Equal;
  // excludes = MUST ONLY equals
  if (!someEquals && someExcludes && !someSuperset && !someSubset) return IntersectResult.Exclusive;
  // superset = MUST superset MAYBE equal
  if (!someExcludes && someSuperset && !someSubset) return IntersectResult.Superset;
  // subset = MUST subset MAYBE equal
  if (!someExcludes && !someSuperset && someSubset) return IntersectResult.Subset;
  // intersect = any other condition
  return IntersectResult.Intersect;
}

/**
 * Check if first BitArray is equal to or superset of the second
 */
export function isSuperSetOrEqual(superSet: BitArray, toCheck: BitArray): boolean {
  const intersectionResult = intersectUint8Arrays(superSet.uint8Array, toCheck.uint8Array);
  return intersectionResult === IntersectResult.Superset || intersectionResult === IntersectResult.Equal;
}
