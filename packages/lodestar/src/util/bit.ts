import {BitArray} from "@chainsafe/bit-utils/lib/base";

/**
 * Returns count of true bits in bitarray
 * @param bitArray
 */
export function getBitCount(bitArray: BitArray): number {
  let count = 0;
  for(let i = 0; i < bitArray.bitLength; i++) {
    if(bitArray.getBit(i)) {
      count++;
    }
  }
  return count;
}