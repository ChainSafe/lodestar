import {
  bitLength,
  previousPowerOf2
} from "../../util/bigintMath";

import {GeneralizedIndex} from "./types";

/**
 * Given generalized indices i1 for A -> B, i2 for B -> C .... i_n for Y -> Z, returns
 * the generalized index for A -> Z.
 */
export function concat(indices: GeneralizedIndex[]): GeneralizedIndex {
  let o = BigInt(1);
  for (const i of indices) {
    const pPowOf2 = previousPowerOf2(i);
    o = o * pPowOf2 + (i - pPowOf2);
  }
  return o;
}

/**
 * Return the length of a path represented by a generalized index.
 */
export function length(index: GeneralizedIndex): number {
  return bitLength(index);
}

/**
 * Return the given bit of a generalized index.
 */
export function bit(index: GeneralizedIndex, position: number): boolean {
  return (index & (1n << BigInt(position))) > 0n;
}

export function sibling(index: GeneralizedIndex): GeneralizedIndex {
  return index ^ 1n;
}

export function child(index: GeneralizedIndex, rightSide: boolean): GeneralizedIndex {
  return index * 2n + BigInt(rightSide ? 1 : 0);
}

export function parent(index: GeneralizedIndex): GeneralizedIndex {
  return index / 2n;
}
