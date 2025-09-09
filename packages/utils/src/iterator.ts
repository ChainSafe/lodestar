// ES2024 onward we have Array.fromAsync which does exactly this
// This function is here as wrapper to be deleted later when we upgrade
// minimum nodejs requirement to > 22
export async function fromAsync<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const arr: T[] = [];
  for await (const v of iter) {
    arr.push(v);
  }
  return arr;
}
