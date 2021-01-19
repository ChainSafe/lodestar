/**
 * Return the last index in the array that matches the predicate
 */
export function findLastIndex<T>(array: T[], predicate: (value: T) => boolean): number {
  let i = array.length;
  while (i--) {
    if (predicate(array[i])) {
      return i;
    }
  }
  return -1;
}
