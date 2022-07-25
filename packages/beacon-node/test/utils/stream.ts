export type AllFn<T> = (source: AsyncIterable<T>) => Promise<T[]>;

/**
 * Collects all values from an (async) iterable into an array and returns it.
 */
export async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
  const arr: T[] = [];

  for await (const entry of source) {
    arr.push(entry);
  }

  return arr;
}
