import {Level} from "level";
import type {ClassicLevel} from "classic-level";
import {Logger} from "@lodestar/utils";
import {DbReqOpts, DatabaseController, DatabaseOptions, FilterOptions, KeyValue} from "./interface.js";
import {LevelDbControllerMetrics} from "./metrics.js";

enum Status {
  started = "started",
  stopped = "stopped",
}

type LevelNodeJS = ClassicLevel<Uint8Array, Uint8Array>;

export interface LevelDBOptions extends DatabaseOptions {
  db?: Level<Uint8Array, Uint8Array>;
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
  private status = Status.stopped;
  private db: Level<Uint8Array, Uint8Array>;

  private readonly opts: LevelDBOptions;
  private readonly logger: Logger;
  private metrics: LevelDbControllerMetrics | null;
  private dbSizeMetricInterval?: NodeJS.Timer;

  constructor(opts: LevelDBOptions, {metrics, logger}: LevelDbControllerModules) {
    this.opts = opts;
    this.logger = logger;
    this.metrics = metrics ?? null;
    this.db = opts.db || new Level(opts.name || "beaconchain", {keyEncoding: "binary", valueEncoding: "binary"});
  }

  async start(): Promise<void> {
    if (this.status === Status.started) return;
    this.status = Status.started;

    await this.db.open();

    if (this.metrics) {
      this.collectDbSizeMetric();
    }
  }

  async stop(): Promise<void> {
    if (this.status === Status.stopped) return;
    this.status = Status.stopped;

    if (this.dbSizeMetricInterval) {
      clearInterval(this.dbSizeMetricInterval);
    }

    await this.db.close();
  }

  /** To inject metrics after CLI initialization */
  setMetrics(metrics: LevelDbControllerMetrics): void {
    if (this.metrics !== null) {
      throw Error("metrics can only be set once");
    } else {
      this.metrics = metrics;
      if (this.status === Status.started) {
        this.collectDbSizeMetric();
      }
    }
  }

  async clear(): Promise<void> {
    await this.db.clear();
  }

  async get(key: Uint8Array, opts?: DbReqOpts): Promise<Uint8Array | null> {
    try {
      this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
      this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
      return (await this.db.get(key)) as Uint8Array | null;
    } catch (e) {
      if ((e as LevelDbError).code === "LEVEL_NOT_FOUND") {
        return null;
      }
      throw e;
    }
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

  keysStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    return this.metricsIterator(this.db.keys(opts), (key) => key, opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  valuesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    return this.metricsIterator(this.db.values(opts), (value) => value, opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  entriesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    return this.metricsIterator(
      this.db.iterator(opts),
      (entry) => ({key: entry[0], value: entry[1]}),
      opts.bucketId ?? BUCKET_ID_UNKNOWN
    );
  }

  keys(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    return this.metricsAll(this.db.keys(opts).all(), opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  values(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    return this.metricsAll(this.db.values(opts).all(), opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  async entries(opts: FilterOptions<Uint8Array> = {}): Promise<KeyValue<Uint8Array, Uint8Array>[]> {
    const entries = await this.metricsAll(this.db.iterator(opts).all(), opts.bucketId ?? BUCKET_ID_UNKNOWN);
    return entries.map((entry) => ({key: entry[0], value: entry[1]}));
  }

  /**
   * Get the approximate number of bytes of file system space used by the range [start..end).
   * The result might not include recently written data.
   */
  approximateSize(start: Uint8Array, end: Uint8Array): Promise<number> {
    return (this.db as LevelNodeJS).approximateSize(start, end);
  }

  /**
   * Manually trigger a database compaction in the range [start..end].
   */
  compactRange(start: Uint8Array, end: Uint8Array): Promise<void> {
    return (this.db as LevelNodeJS).compactRange(start, end);
  }

  /** Capture metrics for db.iterator, db.keys, db.values .all() calls */
  private async metricsAll<T>(promise: Promise<T[]>, bucket: string): Promise<T[]> {
    this.metrics?.dbWriteReq.inc({bucket}, 1);
    const items = await promise;
    this.metrics?.dbWriteItems.inc({bucket}, items.length);
    return items;
  }

  /** Capture metrics for db.iterator, db.keys, db.values AsyncIterable calls */
  private async *metricsIterator<T, K>(
    iterator: AsyncIterable<T>,
    getValue: (item: T) => K,
    bucket: string
  ): AsyncIterable<K> {
    this.metrics?.dbWriteReq.inc({bucket}, 1);

    let itemsRead = 0;

    for await (const item of iterator) {
      // Count metrics after done condition
      itemsRead++;

      yield getValue(item);
    }

    this.metrics?.dbWriteItems.inc({bucket}, itemsRead);
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
}

/** From https://www.npmjs.com/package/level */
type LevelDbError = {code: "LEVEL_NOT_FOUND"};
