/** @module ssz */

/** @ignore */
export function bitLength (n: bigint): number {
  let length = 0;
  while (n !== 0n) {
    n >>= 1n;
    length++;
  }
  return length;
}

/** @ignore */
export function nextPowerOf2 (n: bigint): bigint {
  return n <= 0n ? 1n : 2n ** BigInt(bitLength(n - 1n));
}

/** @ignore */
export function previousPowerOf2 (n: bigint): bigint {
  return n === 0n ? 1n : 2n ** BigInt(bitLength(n) - 1);
}
