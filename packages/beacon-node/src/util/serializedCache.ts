/**
 * A cache to store the serialized version of an object
 *
 * This is a thin wrapper around WeakMap
 */
export class SerializedCache {
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  map: WeakMap<any, Uint8Array> = new WeakMap();

  get<T>(obj: T): Uint8Array | undefined {
    return this.map.get(obj);
  }

  set<T>(obj: T, serialized: Uint8Array): void {
    this.map.set(obj, serialized);
  }

  clear(): void {
    this.map = new WeakMap();
  }
}
