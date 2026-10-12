/**
 * Associates objects with their immutable serialized bytes in both directions.
 */
export class SerializedCache {
  private map: WeakMap<object, Uint8Array> = new WeakMap();
  private deserialized: WeakMap<Uint8Array, object> = new WeakMap();

  get(obj: object): Uint8Array | undefined {
    return this.map.get(obj);
  }

  /** The caller must use the type associated with these exact serialized bytes. */
  getDeserialized<T extends object>(serialized: Uint8Array): T | undefined {
    return this.deserialized.get(serialized) as T | undefined;
  }

  set(obj: object, serialized: Uint8Array): void {
    const previousBytes = this.map.get(obj);
    if (previousBytes !== undefined) this.deserialized.delete(previousBytes);
    const previousObject = this.deserialized.get(serialized);
    if (previousObject !== undefined) this.map.delete(previousObject);
    this.map.set(obj, serialized);
    this.deserialized.set(serialized, obj);
  }

  /**
   * Delete cached serialized entries for the provided object references.
   * Must only be called after all DB writes that read from this cache for these objects have completed,
   * otherwise cached serialized bytes will be unavailable and data will be re-serialized unnecessarily.
   */
  delete(objs: object[]): void {
    for (const obj of objs) {
      const serialized = this.map.get(obj);
      if (serialized !== undefined) this.deserialized.delete(serialized);
      this.map.delete(obj);
    }
  }
}
