/**
 * Backfill a map of sparse data with closest non undefined value of a smaller index
 */
export function backfillMap<T>(map: Map<number, T>, toIndex: number): Map<number, T> {
  const fromIndex = Array.from(map.keys()).sort()[0] ?? toIndex;
  let lastValue: T | undefined = undefined;
  for (let i = fromIndex; i <= toIndex; i++) {
    const value = map.get(i);
    if (value !== undefined) {
      lastValue = value;
    }
    if (value === undefined && lastValue !== undefined) {
      map.set(i, lastValue);
    }
  }
  return map;
}
