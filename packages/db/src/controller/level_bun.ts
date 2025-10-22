import {leveldb} from "@lodestar/bun";
import {Logger} from "@lodestar/utils";
import {DatabaseController, DatabaseOptions, DbReqOpts, FilterOptions, KeyValue} from "./interface.js";
import {LevelDbControllerMetrics} from "./metrics.js";

const {
  dbBatchDelete,
  dbBatchPut,
  dbClose,
  dbDelete,
  dbDestroy,
  dbGet,
  dbIterator,
  dbOpen,
  dbPut,
  iteratorDestroy,
  iteratorKey,
  iteratorNext,
  iteratorPrev,
  iteratorSeek,
  iteratorSeekToFirst,
  iteratorSeekToLast,
  iteratorValid,
  iteratorValue,
} = leveldb;

export type LevelDbControllerModules = {
  logger: Logger;
  metrics?: LevelDbControllerMetrics | null;
};

export enum Status {
  started = "started",
  closed = "closed",
}

const BUCKET_ID_UNKNOWN = "unknown";

export class LevelDbController implements DatabaseController<Uint8Array, Uint8Array> {
  private status = Status.started;

  constructor(
    private readonly db: leveldb.DB,
    private metrics: LevelDbControllerMetrics | null
  ) {}

  static async create(options: DatabaseOptions, {metrics}: LevelDbControllerModules): Promise<LevelDbController> {
    const db = dbOpen(options.name, {create_if_missing: true});
    return new LevelDbController(db, metrics ?? null);
  }

  static async destroy(location: string): Promise<void> {
    dbDestroy(location);
  }

  async close(): Promise<void> {
    if (this.status === Status.closed) {
      return;
    }
    this.status = Status.closed;

    dbClose(this.db);
  }

  setMetrics(metrics: LevelDbControllerMetrics): void {
    if (this.metrics !== null) {
      throw new Error("Metrics already set");
    }
    this.metrics = metrics;
  }

  async get(key: Uint8Array, opts?: DbReqOpts): Promise<Uint8Array | null> {
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);

    return dbGet(this.db, key);
  }

  async getMany(keys: Uint8Array[], opts?: DbReqOpts): Promise<(Uint8Array | undefined)[]> {
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);

    return keys.map((key) => dbGet(this.db, key) ?? undefined);
  }

  async put(key: Uint8Array, value: Uint8Array, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);

    dbPut(this.db, key, value);
  }

  async delete(key: Uint8Array, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);

    dbDelete(this.db, key);
  }

  async batchPut(items: KeyValue<Uint8Array, Uint8Array>[], opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, items.length);

    dbBatchPut(this.db, items);
  }

  async batchDelete(keys: Uint8Array[], opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);

    dbBatchDelete(this.db, keys);
  }

  keysStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    const {bucket, iterator, limit, next, outOfRange} = consumeFilterOptions(this.db, opts);

    const metrics = this.metrics;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;
    return (async function* () {
      try {
        while (iteratorValid(iterator) && itemsRead < limit) {
          const key = iteratorKey(iterator);
          if (outOfRange?.(key)) break;
          itemsRead++;
          yield key;
          next(iterator);
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        iteratorDestroy(iterator);
      }
    })();
  }

  async keys(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    const {bucket, iterator, limit, next, outOfRange} = consumeFilterOptions(this.db, opts);
    const keys = [];
    this.metrics?.dbReadReq.inc({bucket}, 1);
    try {
      while (iteratorValid(iterator) && keys.length < limit) {
        const key = iteratorKey(iterator);
        if (outOfRange?.(key)) break;
        keys.push(key);
        next(iterator);
      }
      return keys;
    } finally {
      this.metrics?.dbReadItems.inc({bucket}, keys.length);
      iteratorDestroy(iterator);
    }
  }

  valuesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    const {bucket, iterator, limit, next, outOfRange} = consumeFilterOptions(this.db, opts);
    const metrics = this.metrics;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;
    return (async function* () {
      try {
        while (iteratorValid(iterator) && itemsRead < limit) {
          const key = iteratorKey(iterator);
          if (outOfRange?.(key)) break;
          itemsRead++;
          const value = iteratorValue(iterator);
          yield value;
          next(iterator);
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        iteratorDestroy(iterator);
      }
    })();
  }

  async values(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    const {bucket, iterator, limit, next, outOfRange} = consumeFilterOptions(this.db, opts);
    const values = [];
    this.metrics?.dbReadReq.inc({bucket}, 1);
    try {
      while (iteratorValid(iterator) && values.length < limit) {
        const key = iteratorKey(iterator);
        if (outOfRange?.(key)) break;
        const value = iteratorValue(iterator);
        values.push(value);
        next(iterator);
      }
      return values;
    } finally {
      this.metrics?.dbReadItems.inc({bucket}, values.length);
      iteratorDestroy(iterator);
    }
  }

  entriesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    const {bucket, iterator, limit, next, outOfRange} = consumeFilterOptions(this.db, opts);
    const metrics = this.metrics;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;
    return (async function* () {
      try {
        while (iteratorValid(iterator) && itemsRead < limit) {
          const key = iteratorKey(iterator);
          if (outOfRange?.(key)) break;
          itemsRead++;
          const value = iteratorValue(iterator);
          yield {key, value};
          next(iterator);
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        iteratorDestroy(iterator);
      }
    })();
  }

  async entries(opts: FilterOptions<Uint8Array> = {}): Promise<KeyValue<Uint8Array, Uint8Array>[]> {
    const {bucket, iterator, limit, next, outOfRange} = consumeFilterOptions(this.db, opts);
    const entries = [];
    this.metrics?.dbReadReq.inc({bucket}, 1);
    try {
      while (iteratorValid(iterator) && entries.length < limit) {
        const key = iteratorKey(iterator);
        if (outOfRange?.(key)) break;
        const value = iteratorValue(iterator);
        entries.push({key, value});
        next(iterator);
      }
      return entries;
    } finally {
      this.metrics?.dbReadItems.inc({bucket}, entries.length);
      iteratorDestroy(iterator);
    }
  }
}

/**
 * Return initialized iterator, filter options and operations.
 */
function consumeFilterOptions(db: leveldb.DB, opts: FilterOptions<Uint8Array>) {
  const iterator = dbIterator(db);

  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  let next: (it: leveldb.Iterator) => void;
  let seekToFirst: (it: leveldb.Iterator) => void;
  let gt: Uint8Array | undefined;
  let gte: Uint8Array | undefined;
  let outOfRange: ((k: Uint8Array) => boolean) | undefined;
  if (opts.reverse) {
    next = iteratorPrev;
    seekToFirst = iteratorSeekToLast;
    gt = opts.lt;
    gte = opts.lte;
    outOfRange = opts.gt
      ? (k: Uint8Array) => Buffer.compare(k, opts.gt as Uint8Array) <= 0
      : opts.gte
        ? (k: Uint8Array) => Buffer.compare(k, opts.gte as Uint8Array) < 0
        : undefined;
  } else {
    next = iteratorNext;
    seekToFirst = iteratorSeekToFirst;
    gt = opts.gt;
    gte = opts.gte;
    outOfRange = opts.lt
      ? (k: Uint8Array) => Buffer.compare(k, opts.lt as Uint8Array) >= 0
      : opts.lte
        ? (k: Uint8Array) => Buffer.compare(k, opts.lte as Uint8Array) > 0
        : undefined;
  }
  if (gt) {
    iteratorSeek(iterator, gt);
    next(iterator);
  } else if (gte) {
    iteratorSeek(iterator, gte);
  } else {
    seekToFirst(iterator);
  }
  const bucket = opts.bucketId ?? BUCKET_ID_UNKNOWN;

  return {bucket, iterator, limit, next, outOfRange};
}
