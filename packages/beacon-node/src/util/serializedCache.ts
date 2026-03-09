/**
 * A cache to store the serialized version of an object
 *
 * This is a thin wrapper around WeakMap
 */
export class SerializedCache {
  private map: WeakMap<object, Uint8Array> = new WeakMap();

  get(obj: object): Uint8Array | undefined {
    return this.map.get(obj);
  }

  set(obj: object, serialized: Uint8Array): void {
    this.map.set(obj, serialized);
  }

  /**
   * Delete cached serialized entries for the provided object identities.
   * Must only be called after all DB writes that may read from this cache have completed,
   * otherwise cached serialized bytes will be unavailable and data will be re-serialized unnecessarily.
   */
  delete(objs: object[]): void {
    for (const obj of objs) {
      this.map.delete(obj);
    }
  }
}
