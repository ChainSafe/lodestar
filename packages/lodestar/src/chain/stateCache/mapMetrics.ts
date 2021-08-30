import {IAvgMinMax} from "../../metrics";

type MapTrackerMetrics = {
  reads: IAvgMinMax;
  secondsSinceLastRead: IAvgMinMax;
};

export class MapTracker<K, V> extends Map<K, V> {
  /** Tracks the number of reads each entry in the cache gets for metrics */
  readonly readCount = new Map<K, number>();
  /** Tracks the last time a state was read from the cache */
  readonly lastRead = new Map<K, number>();

  constructor(metrics?: MapTrackerMetrics) {
    super();
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

  get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      this.readCount.set(key, 1 + (this.readCount.get(key) ?? 0));
      this.lastRead.set(key, Date.now());
    }
    return value;
  }

  delete(key: K): boolean {
    const deleted = super.delete(key);
    if (deleted) {
      this.readCount.delete(key);
      this.lastRead.delete(key);
    }
    return deleted;
  }

  clear(): void {
    super.clear();
    this.readCount.clear();
    this.lastRead.clear();
  }
}
