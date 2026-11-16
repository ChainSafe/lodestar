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
 * For all bytes in BitArray, bytes missing from the shorter array count as zero:
 * - equals = neither has a bit the other lacks
 * - superset = only A has bits B lacks
 * - subset = only B has bits A lacks
 * - exclude = both have bits the other lacks, none shared
 * - intersect = both have bits the other lacks, some shared
 */
export function intersectUint8Arrays(aUA: Uint8Array, bUA: Uint8Array): IntersectResult {
  const len = Math.max(aUA.length, bUA.length);

  let aHasExtra = false;
  let bHasExtra = false;
  let hasShared = false;

  for (let i = 0; i < len; i++) {
    const a = aUA[i] ?? 0;
    const b = bUA[i] ?? 0;

    if ((a & b) !== 0) hasShared = true;
    if ((a & ~b) !== 0) aHasExtra = true;
    if ((b & ~a) !== 0) bHasExtra = true;

    if (aHasExtra && bHasExtra && hasShared) return IntersectResult.Intersect;
  }

  if (!aHasExtra && !bHasExtra) return IntersectResult.Equal;
  if (!bHasExtra) return IntersectResult.Superset;
  if (!aHasExtra) return IntersectResult.Subset;
  return hasShared ? IntersectResult.Intersect : IntersectResult.Exclusive;
}

/**
 * Check if first BitArray is equal to or superset of the second
 */
export function isSuperSetOrEqual(superSet: BitArray, toCheck: BitArray): boolean {
  if (superSet.bitLen !== toCheck.bitLen) return false;
  const intersectionResult = intersectUint8Arrays(superSet.uint8Array, toCheck.uint8Array);
  return intersectionResult === IntersectResult.Superset || intersectionResult === IntersectResult.Equal;
}
