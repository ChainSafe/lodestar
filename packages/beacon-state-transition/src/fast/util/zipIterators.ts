type Iteratorify<T> = {[K in keyof T]: Iterable<T[K]>};
export function* zipIterators<T extends Array<any>>(...iterators: Iteratorify<T>): IterableIterator<T> {
  const zippedIterators = iterators.map((i) => i[Symbol.iterator]());
  while (true) {
    const results = zippedIterators.map((i) => i.next());

    if (results.some((r) => r.done)) {
      return;
    }

    yield results.map((r) => r.value) as T;
  }
}
