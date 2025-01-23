/**
 * A cache to store the serialized version of an object
 *
 * This is a thin wrapper around WeakMap
 */
export class SerializedCache {
  map: WeakMap<object, Uint8Array> = new WeakMap();

  get(obj: object): Uint8Array | undefined {
    return this.map.get(obj);
  }

  set(obj: object, serialized: Uint8Array): void {
    this.map.set(obj, serialized);
  }

  clear(): void {
    this.map = new WeakMap();
  }
}
