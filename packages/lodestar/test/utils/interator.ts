export async function* iteratorFromArray<T>(values: T[]): AsyncIterable<T> {
  for (let i = 0; i < values.length; i++) {
    yield values[i];
  }
}
