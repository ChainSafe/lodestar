import {BitArray} from "@chainsafe/ssz";

/**
 * Create a bitvector with the first N bits set to true
 */
export function initTrueBits(bitLen: number, n: number): BitArray {
  const bitvector = BitArray.fromBitLen(bitLen);
  for (let i = 0; i < n; i++) {
    bitvector.set(i, true);
  }
  return bitvector;
}
