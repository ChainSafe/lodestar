import {ClassicLevel} from "classic-level";
import {Logger} from "@lodestar/utils";
import {DatabaseController, DatabaseOptions, DbBatch, DbReqOpts, FilterOptions, KeyValue} from "./interface.js";
import {LevelDbControllerMetrics} from "./metrics.js";

enum Status {
  started = "started",
  closed = "closed",
}

export interface LevelDBOptions extends DatabaseOptions {
  db?: ClassicLevel<Uint8Array, Uint8Array>;
}

export type LevelDbControllerModules = {
  logger: Logger;
  metrics?: LevelDbControllerMetrics | null;
};

const BUCKET_ID_UNKNOWN = "unknown";

/** Time between capturing metric for db size, every few minutes is sufficient */
const DB_SIZE_METRIC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The LevelDB implementation of DB
 */
export class LevelDbController implements DatabaseController<Uint8Array, Uint8Array> {
  private status = Status.started;

  private dbSizeMetricInterval?: NodeJS.Timeout;

  constructor(
    private readonly logger: Logger,
    private readonly db: ClassicLevel<Uint8Array, Uint8Array>,
    private metrics: LevelDbControllerMetrics | null
  ) {
    this.metrics = metrics ?? null;

    if (this.metrics) {
      this.collectDbSizeMetric();
    }
  }

  get boundedReadVersion(): 1 | undefined {
    return this.db.boundedReadVersion === 1 ? 1 : undefined;
  }

  private captureReadOptions(opts?: DbReqOpts): DbReqOpts {
    const {readLimits, fillCache, bucketId} = opts ?? {};
    return {
      bucketId,
      ...(readLimits === undefined ? {} : {readLimits}),
      ...(fillCache === undefined ? {} : {fillCache}),
    };
  }

  /** The options classic-level reads for a get or getMany */
  private levelReadOptions(opts: DbReqOpts): {readLimits?: DbReqOpts["readLimits"]; fillCache?: boolean} {
    const {readLimits, fillCache} = opts;
    return {...(readLimits === undefined ? {} : {readLimits}), ...(fillCache === undefined ? {} : {fillCache})};
  }

  private captureFilterOptions(opts: FilterOptions<Uint8Array>): FilterOptions<Uint8Array> {
    const {readLimits, fillCache, rowAtATime, bucketId, gt, gte, lt, lte, reverse, limit} = opts;
    return {
      ...this.captureReadOptions({readLimits, fillCache, bucketId}),
      ...(rowAtATime === undefined ? {} : {rowAtATime}),
      ...(gt === undefined ? {} : {gt}),
      ...(gte === undefined ? {} : {gte}),
      ...(lt === undefined ? {} : {lt}),
      ...(lte === undefined ? {} : {lte}),
      ...(reverse === undefined ? {} : {reverse}),
      ...(limit === undefined ? {} : {limit}),
    };
  }

  private checkReadLimits(opts?: DbReqOpts): void {
    if (opts?.readLimits !== undefined && this.boundedReadVersion !== 1) {
      throw Object.assign(new Error("Bounded reads are unsupported"), {code: "LEVEL_BOUNDED_READ_UNSUPPORTED"});
    }
  }

  static async create(opts: LevelDBOptions, {metrics, logger}: LevelDbControllerModules): Promise<LevelDbController> {
    const db =
      opts.db ||
      new ClassicLevel(opts.name || "beaconchain", {
        keyEncoding: "binary",
        valueEncoding: "binary",
        multithreading: true,
      });

    try {
      await db.open();
    } catch (e) {
      if ((e as LevelDbError).cause?.code === "LEVEL_LOCKED") {
        throw new Error("Database already in use by another process");
      }
      throw e;
    }

    return new LevelDbController(logger, db, metrics ?? null);
  }

  async close(): Promise<void> {
    if (this.status === Status.closed) return;
    this.status = Status.closed;

    if (this.dbSizeMetricInterval) {
      clearInterval(this.dbSizeMetricInterval);
    }

    await this.db.close();
  }

  /** To inject metrics after CLI initialization */
  setMetrics(metrics: LevelDbControllerMetrics): void {
    if (this.metrics !== null) {
      throw Error("metrics can only be set once");
    }

    this.metrics = metrics;
    if (this.status === Status.started) {
      this.collectDbSizeMetric();
    }
  }

  async clear(): Promise<void> {
    await this.db.clear();
  }

  async get(key: Uint8Array, opts?: DbReqOpts): Promise<Uint8Array | null> {
    opts = this.captureReadOptions(opts);
    this.checkReadLimits(opts);
    try {
      this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
      this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
      return (await this.db.get(key, this.levelReadOptions(opts))) as Uint8Array | null;
    } catch (e) {
      if ((e as LevelDbError).code === "LEVEL_NOT_FOUND") {
        return null;
      }
      throw e;
    }
  }

  /**
   * Return the multiple items in the order of the given keys
   * Will return `null` for the keys which does not exists
   *
   * https://github.com/Level/abstract-level?tab=readme-ov-file#dbgetmanykeys-options
   */
  async getMany(keys: Uint8Array[], opts?: DbReqOpts): Promise<(Uint8Array | undefined)[]> {
    opts = this.captureReadOptions(opts);
    this.checkReadLimits(opts);
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);
    return await this.db.getMany(keys, this.levelReadOptions(opts));
  }

  put(key: Uint8Array, value: Uint8Array, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);

    return this.db.put(key, value);
  }

  delete(key: Uint8Array, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);

    return this.db.del(key);
  }

  batchPut(items: KeyValue<Uint8Array, Uint8Array>[], opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, items.length);

    return this.db.batch(items.map((item) => ({type: "put", key: item.key, value: item.value})));
  }

  batchDelete(keys: Uint8Array[], opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);

    return this.db.batch(keys.map((key) => ({type: "del", key: key})));
  }

  batch(batch: DbBatch<Uint8Array, Uint8Array>, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, batch.length);

    return this.db.batch(batch);
  }

  keysStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    opts = this.captureFilterOptions(opts);
    this.checkReadLimits(opts);
    return this.readIterator(this.db.keys(opts), opts, (key) => key);
  }

  valuesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    opts = this.captureFilterOptions(opts);
    this.checkReadLimits(opts);
    return this.readIterator(this.db.values(opts), opts, (value) => value);
  }

  entriesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    opts = this.captureFilterOptions(opts);
    this.checkReadLimits(opts);
    return this.readIterator(this.db.iterator(opts), opts, (entry) => ({key: entry[0], value: entry[1]}));
  }

  keys(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    opts = this.captureFilterOptions(opts);
    if (opts.readLimits !== undefined) return Array.fromAsync(this.keysStream(opts));
    return this.metricsAll(this.db.keys(opts).all(), opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  values(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    opts = this.captureFilterOptions(opts);
    if (opts.readLimits !== undefined) return Array.fromAsync(this.valuesStream(opts));
    return this.metricsAll(this.db.values(opts).all(), opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  async entries(opts: FilterOptions<Uint8Array> = {}): Promise<KeyValue<Uint8Array, Uint8Array>[]> {
    opts = this.captureFilterOptions(opts);
    if (opts.readLimits !== undefined) return Array.fromAsync(this.entriesStream(opts));
    const entries = await this.metricsAll(this.db.iterator(opts).all(), opts.bucketId ?? BUCKET_ID_UNKNOWN);
    return entries.map((entry) => ({key: entry[0], value: entry[1]}));
  }

  /**
   * Get the approximate number of bytes of file system space used by the range [start..end).
   * The result might not include recently written data.
   */
  approximateSize(start: Uint8Array, end: Uint8Array): Promise<number> {
    return this.db.approximateSize(start, end);
  }

  /**
   * Manually trigger a database compaction in the range [start..end].
   */
  compactRange(start: Uint8Array, end: Uint8Array): Promise<void> {
    return this.db.compactRange(start, end);
  }

  private readIterator<T, K>(
    iterator: AsyncIterable<T> & {nextv(size: number): Promise<T[]>; close(): Promise<void>},
    opts: FilterOptions<Uint8Array>,
    getValue: (item: T) => K
  ): AsyncIterable<K> {
    const bucket = opts.bucketId ?? BUCKET_ID_UNKNOWN;
    if (opts.readLimits === undefined && opts.rowAtATime !== true)
      return this.metricsIterator(iterator, getValue, bucket);
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= iterator.close();
      return closing;
    };
    // A bounded iterator reads only the rows its limit allows; a stock row-at-a-time stream reads to its end
    const rows = this.rowAtATimeIterator(iterator, opts.limit ?? (opts.readLimits === undefined ? Infinity : 0), close);
    const measured = this.metricsIterator(rows, getValue, bucket)[Symbol.asyncIterator]();
    // The snapshot already exists even if neither generator has started.
    const stream: AsyncIterableIterator<K> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => measured.next(),
      return: async () => {
        try {
          return (await measured.return?.()) ?? {done: true, value: undefined};
        } finally {
          await close();
        }
      },
      throw: async (error: unknown) => {
        try {
          if (measured.throw) return await measured.throw(error);
          throw error;
        } finally {
          await close();
        }
      },
    };
    return stream;
  }

  private async *rowAtATimeIterator<T>(
    iterator: {nextv(size: number): Promise<T[]>},
    limit: number,
    close: () => Promise<void>
  ): AsyncIterable<T> {
    try {
      for (let i = 0; i < limit; i++) {
        const rows = await iterator.nextv(1);
        if (rows.length === 0) return;
        yield rows[0];
      }
    } finally {
      await close();
    }
  }

  /** Capture metrics for db.iterator, db.keys, db.values .all() calls */
  private async metricsAll<T>(promise: Promise<T[]>, bucket: string): Promise<T[]> {
    this.metrics?.dbReadReq.inc({bucket}, 1);
    const items = await promise;
    this.metrics?.dbReadItems.inc({bucket}, items.length);
    return items;
  }

  /** Capture metrics for db.iterator, db.keys, db.values AsyncIterable calls */
  private async *metricsIterator<T, K>(
    iterator: AsyncIterable<T>,
    getValue: (item: T) => K,
    bucket: string
  ): AsyncIterable<K> {
    this.metrics?.dbReadReq.inc({bucket}, 1);

    let itemsRead = 0;

    for await (const item of iterator) {
      // Count metrics after done condition
      itemsRead++;

      yield getValue(item);
    }

    this.metrics?.dbReadItems.inc({bucket}, itemsRead);
  }

  /** Start interval to capture metric for db size */
  private collectDbSizeMetric(): void {
    this.dbSizeMetric();
    this.dbSizeMetricInterval = setInterval(this.dbSizeMetric.bind(this), DB_SIZE_METRIC_INTERVAL_MS);
  }

  /** Capture metric for db size */
  private dbSizeMetric(): void {
    const timer = this.metrics?.dbApproximateSizeTime.startTimer();
    const minKey = Buffer.from([0x00]);
    const maxKey = Buffer.from([0xff]);

    this.approximateSize(minKey, maxKey)
      .then((dbSize) => {
        this.metrics?.dbSizeTotal.set(dbSize);
      })
      .catch((e) => {
        this.logger.debug("Error approximating db size", {}, e);
      })
      .finally(timer);
  }

  static async destroy(location: string): Promise<void> {
    return ClassicLevel.destroy(location);
  }
}

/** From https://www.npmjs.com/package/level */
type LevelDbError = {code: "LEVEL_NOT_FOUND"; cause?: {code: "LEVEL_LOCKED"}};
