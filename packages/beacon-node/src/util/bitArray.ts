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
 * Compare a and b as sets of bit indices. Bytes missing from the shorter array count as zero.
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
