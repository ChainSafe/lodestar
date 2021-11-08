import {IAvgMinMax} from "../../metrics";

type MapTrackerMetrics = {
  reads: IAvgMinMax;
  secondsSinceLastRead: IAvgMinMax;
};

// eslint-disable-next-line @typescript-eslint/ban-types
export class MapTrackerWeakRef<K, V extends object> {
  readonly values = new Map<K, WeakRef<V>>();
  /** Tracks the number of reads each entry in the cache gets for metrics */
  readonly readCount = new Map<K, number>();
  /** Tracks the last time a state was read from the cache */
  readonly lastRead = new Map<K, number>();

  constructor(metrics?: MapTrackerMetrics) {
    if (metrics) {
      metrics.reads.addGetValuesFn(() => Array.from(this.readCount.values()));
      metrics.secondsSinceLastRead.addGetValuesFn(() => {
        const now = Date.now();
        const secondsSinceLastRead: number[] = [];
        for (const lastRead of this.lastRead.values()) {
          secondsSinceLastRead.push((now - lastRead) / 1000);
        }
        return secondsSinceLastRead;
      });
    }
  }

  get size(): number {
    return this.values.size;
  }

  get(key: K): V | undefined {
    const valueWeakRef = this.values.get(key);
    if (valueWeakRef === undefined) {
      return undefined;
    }

    const value = valueWeakRef.deref();
    // Clean GC'ed references
    if (value === undefined) {
      this.delete(key);
      return undefined;
    }

    this.readCount.set(key, 1 + (this.readCount.get(key) ?? 0));
    this.lastRead.set(key, Date.now());
    return value;
  }

  set(key: K, value: V): void {
    this.values.set(key, new WeakRef(value));
  }

  delete(key: K): boolean {
    const deleted = this.values.delete(key);
    if (deleted) {
      this.readCount.delete(key);
      this.lastRead.delete(key);
    }
    return deleted;
  }

  has(key: K): boolean {
    return this.values.has(key);
  }

  keys(): IterableIterator<K> {
    return this.values.keys();
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [key, weakRef] of this.values.entries()) {
      const value = weakRef.deref();
      if (value) {
        yield [key, value];
      }
    }
  }

  clear(): void {
    this.values.clear();
    this.readCount.clear();
    this.lastRead.clear();
  }
}
