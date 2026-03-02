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

  /**
   * Replace the internal WeakMap to force GC of all cached entries.
   * Must only be called after all DB writes that may read from this cache have completed,
   * otherwise cached serialized bytes will be unavailable and data will be re-serialized unnecessarily.
   */
  clear(): void {
    this.map = new WeakMap();
  }
}
