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

export function sliceBitArray(bitArray: BitArray, start: number, bitLen: number): BitArray {
  if (start < 0 || bitLen < 0 || start + bitLen > bitArray.bitLen) {
    throw new Error(`Bit range out of bounds start=${start} bitLen=${bitLen} sourceBitLen=${bitArray.bitLen}`);
  }

  const source = bitArray.uint8Array;
  const byteLen = Math.ceil(bitLen / 8);
  const sliced = new Uint8Array(byteLen);
  const byteOffset = Math.floor(start / 8);
  const bitOffset = start % 8;

  if (bitOffset === 0) {
    sliced.set(source.subarray(byteOffset, byteOffset + byteLen));
  } else {
    for (let i = 0; i < byteLen; i++) {
      const low = source[byteOffset + i] >> bitOffset;
      const high = byteOffset + i + 1 < source.length ? source[byteOffset + i + 1] << (8 - bitOffset) : 0;
      sliced[i] = low | high;
    }
  }

  // isSuperSetOrEqual and countTrueBits read whole bytes, so bits past bitLen must stay zero
  const bitsInLastByte = bitLen % 8;
  if (bitsInLastByte !== 0) {
    sliced[byteLen - 1] &= (1 << bitsInLastByte) - 1;
  }

  return new BitArray(sliced, bitLen);
}

function buildTrueBitsByByte(): Uint8Array {
  const trueBitsByByte = new Uint8Array(256);
  for (let byte = 1; byte < 256; byte++) {
    trueBitsByByte[byte] = trueBitsByByte[byte >> 1] + (byte & 1);
  }
  return trueBitsByByte;
}

const TRUE_BITS_BY_BYTE = buildTrueBitsByByte();

/** Bits past `bitLen` in the last byte must be zero */
export function countTrueBits(bitArray: BitArray): number {
  const bytes = bitArray.uint8Array;
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    count += TRUE_BITS_BY_BYTE[bytes[i]];
  }
  return count;
}
