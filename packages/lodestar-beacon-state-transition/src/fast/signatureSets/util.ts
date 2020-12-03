export function flatten<T>(arrNested: T[][]): T[] {
  const flat: T[] = [];
  for (const arr of arrNested) {
    for (const el of arr) {
      flat.push(el);
    }
  }
  return flat;
}
