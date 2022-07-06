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

/**
 * Returns an array with all values not in the participants array.
 * - All elements in values must be unique
 * - Does NOT require sorting
 */
export function getUnparticipantValues<T>(participants: T[], values: T[]): T[] {
  const unparticipants: T[] = [];

  let j = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === participants[j]) {
      // Included
      j++;
    } else {
      unparticipants.push(values[i]);
    }
  }

  return unparticipants;
}
