/**
 * A cache to store the serialized version of an object.
 */
export class SerializedCache {
  private map: WeakMap<object, Uint8Array> = new WeakMap();
  private readonly deserialized?: WeakMap<Uint8Array, object>;

  constructor(opts: {cacheDeserialized?: boolean} = {}) {
    if (opts.cacheDeserialized) this.deserialized = new WeakMap();
  }

  get(obj: object): Uint8Array | undefined {
    return this.map.get(obj);
  }

  /** The caller must use the SSZ type associated with these exact, immutable bytes. */
  getDeserialized<T extends object>(serialized: Uint8Array): T | undefined {
    return this.deserialized?.get(serialized) as T | undefined;
  }

  set(obj: object, serialized: Uint8Array): void {
    const previousBytes = this.map.get(obj);
    if (previousBytes !== undefined && this.deserialized?.get(previousBytes) === obj) {
      this.deserialized.delete(previousBytes);
    }
    this.map.set(obj, serialized);
    this.deserialized?.set(serialized, obj);
  }

  /**
   * Delete cached serialized entries for the provided object references.
   * Must only be called after all DB writes that read from this cache for these objects have completed,
   * otherwise cached serialized bytes will be unavailable and data will be re-serialized unnecessarily.
   */
  delete(objs: object[]): void {
    for (const obj of objs) {
      const serialized = this.map.get(obj);
      if (serialized !== undefined && this.deserialized?.get(serialized) === obj) {
        this.deserialized.delete(serialized);
      }
      this.map.delete(obj);
    }
  }
}
