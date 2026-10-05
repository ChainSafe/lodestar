import {LevelDb, LevelDbIteratorOptions, LevelDbReadManyOptions} from "@chainsafe/lodestar-z/leveldb";
import {Logger} from "@lodestar/utils";
import {DatabaseController, DatabaseOptions, DbBatch, DbReqOpts, FilterOptions, KeyValue} from "./interface.js";
import {LevelDbControllerMetrics} from "./metrics.js";

enum Status {
  started = "started",
  closed = "closed",
}

export interface LevelDBOptions extends DatabaseOptions {
  /** An already-open database whose ownership transfers to the controller. */
  db?: LevelDb;
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
  private closing?: Promise<void>;

  private dbSizeMetricInterval?: NodeJS.Timeout;

  constructor(
    private readonly logger: Logger,
    private readonly db: LevelDb,
    private metrics: LevelDbControllerMetrics | null
  ) {
    this.metrics = metrics ?? null;

    if (this.metrics) {
      this.collectDbSizeMetric();
    }
  }

  static async create(opts: LevelDBOptions, {metrics, logger}: LevelDbControllerModules): Promise<LevelDbController> {
    const db = opts.db ?? (await LevelDb.open(opts.name || "beaconchain", {multithreading: true}));

    return new LevelDbController(logger, db, metrics ?? null);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.status = Status.closed;

    if (this.dbSizeMetricInterval) {
      clearInterval(this.dbSizeMetricInterval);
    }

    this.closing = this.db.close().catch((error: unknown) => {
      this.closing = undefined;
      throw error;
    });
    return this.closing;
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
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    return this.db.get(key, levelReadOptions(opts));
  }

  /** Returns values in key order, with undefined for missing keys. */
  async getMany(keys: Uint8Array[], opts?: DbReqOpts): Promise<(Uint8Array | undefined)[]> {
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);
    return (await this.db.getMany(keys, levelReadOptions(opts))).map((value) => value ?? undefined);
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
    return this.metricsIterator(this.db.keys(levelIteratorOptions(opts)), opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  valuesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    return this.metricsIterator(this.db.values(levelIteratorOptions(opts)), opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  entriesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    return this.metricsIterator(this.db.iterator(levelIteratorOptions(opts)), opts.bucketId ?? BUCKET_ID_UNKNOWN);
  }

  keys(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    return Array.fromAsync(this.keysStream(opts));
  }

  values(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    return Array.fromAsync(this.valuesStream(opts));
  }

  async entries(opts: FilterOptions<Uint8Array> = {}): Promise<KeyValue<Uint8Array, Uint8Array>[]> {
    return Array.fromAsync(this.entriesStream(opts));
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

  private metricsIterator<T>(
    iterator: AsyncIterableIterator<T> & {close(): Promise<void>},
    bucket: string
  ): AsyncIterableIterator<T> {
    let started = false;
    let itemsRead = 0;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (!closing) {
        if (started) this.metrics?.dbReadItems.inc({bucket}, itemsRead);
        closing = iterator.close();
      }
      return closing;
    };
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: async () => {
        if (closing) return {done: true, value: undefined};
        if (!started) {
          started = true;
          this.metrics?.dbReadReq.inc({bucket}, 1);
        }
        try {
          const result = await iterator.next();
          if (result.done) await close();
          else itemsRead++;
          return result;
        } catch (error) {
          await close();
          throw error;
        }
      },
      return: async () => {
        await close();
        return {done: true, value: undefined};
      },
      throw: async (error: unknown) => {
        await close();
        throw error;
      },
    };
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
    return LevelDb.destroy(location);
  }
}

function levelReadOptions(opts?: DbReqOpts): LevelDbReadManyOptions {
  return {fillCache: opts?.fillCache, maxValueBytes: opts?.maxValueBytes, maxTotalBytes: opts?.maxTotalBytes};
}

function levelIteratorOptions(opts: FilterOptions<Uint8Array>): LevelDbIteratorOptions {
  const {gt, gte, lt, lte, reverse, fillCache, limit, maxValueBytes, maxTotalBytes} = opts;
  return {
    gt,
    gte,
    lt,
    lte,
    reverse,
    maxValueBytes,
    maxTotalBytes,
    fillCache: fillCache ?? false,
    limit: limit !== undefined && Number.isInteger(limit) && limit >= 0 ? limit : undefined,
    maxEntries: opts.rowAtATime === true ? 1 : undefined,
  };
}
