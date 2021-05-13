/**
 * Returns an array of size `n` filled with 0
 * 20 times faster than
 * ```
 * Array.from({length: n}, () => 0)
 * ```
 * - Array.from: 40ms / 200_000 elements
 * - This fn: 2.2ms / 200_000 elements
 */
export function newZeroedArray(n: number): number[] {
  const arr = new Array<number>(n);
  for (let i = 0; i < n; ++i) {
    arr[i] = 0;
  }
  return arr;
}

export function newZeroedBigIntArray(n: number): bigint[] {
  const arr = new Array<bigint>(n);
  for (let i = 0; i < n; ++i) {
    arr[i] = BigInt(0);
  }
  return arr;
}

export function newFilledArray<T>(n: number, val: T): T[] {
  const arr = new Array<T>(n);
  for (let i = 0; i < n; ++i) {
    arr[i] = val;
  }
  return arr;
}
