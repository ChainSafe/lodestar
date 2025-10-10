import {
  DB,
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
  iteratorSeek,
  iteratorSeekToFirst,
  iteratorValid,
  iteratorValue,
} from "@lodestar/bun";
import {Logger} from "@lodestar/utils";
import {DatabaseController, DatabaseOptions, DbReqOpts, FilterOptions, KeyValue} from "./interface.js";
import {LevelDbControllerMetrics} from "./metrics.js";

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
    private readonly db: DB,
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
    const iterator = dbIterator(this.db);
    if (opts.gt) {
      iteratorSeek(iterator, opts.gt);
      iteratorNext(iterator);
    } else if (opts.gte) {
      iteratorSeek(iterator, opts.gte);
    } else {
      iteratorSeekToFirst(iterator);
    }
    const bucket = opts.bucketId ?? BUCKET_ID_UNKNOWN;
    const metrics = this.metrics;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;
    return (async function* () {
      try {
        while (iteratorValid(iterator)) {
          const key = iteratorKey(iterator);
          if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
          if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
          itemsRead++;
          yield key;
          iteratorNext(iterator);
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        iteratorDestroy(iterator);
      }
    })();
  }

  async keys(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    const iterator = dbIterator(this.db);
    if (opts.gt) {
      iteratorSeek(iterator, opts.gt);
      iteratorNext(iterator);
    } else if (opts.gte) {
      iteratorSeek(iterator, opts.gte);
    } else {
      iteratorSeekToFirst(iterator);
    }
    const keys = [];
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    try {
      while (iteratorValid(iterator)) {
        const key = iteratorKey(iterator);
        if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
        if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
        keys.push(key);
        iteratorNext(iterator);
      }
      return keys;
    } finally {
      this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);
      iteratorDestroy(iterator);
    }
  }

  valuesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    const iterator = dbIterator(this.db);
    if (opts.gt) {
      iteratorSeek(iterator, opts.gt);
      iteratorNext(iterator);
    } else if (opts.gte) {
      iteratorSeek(iterator, opts.gte);
    } else {
      iteratorSeekToFirst(iterator);
    }
    const bucket = opts.bucketId ?? BUCKET_ID_UNKNOWN;
    const metrics = this.metrics;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;
    return (async function* () {
      try {
        while (iteratorValid(iterator)) {
          const key = iteratorKey(iterator);
          if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
          if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
          itemsRead++;
          const value = iteratorValue(iterator);
          yield value;
          iteratorNext(iterator);
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        iteratorDestroy(iterator);
      }
    })();
  }

  async values(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    const iterator = dbIterator(this.db);
    if (opts.gt) {
      iteratorSeek(iterator, opts.gt);
      iteratorNext(iterator);
    } else if (opts.gte) {
      iteratorSeek(iterator, opts.gte);
    } else {
      iteratorSeekToFirst(iterator);
    }
    const values = [];
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    try {
      while (iteratorValid(iterator)) {
        const key = iteratorKey(iterator);
        if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
        if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
        const value = iteratorValue(iterator);
        values.push(value);
        iteratorNext(iterator);
      }
      return values;
    } finally {
      this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, values.length);
      iteratorDestroy(iterator);
    }
  }

  entriesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    const iterator = dbIterator(this.db);
    if (opts.gt) {
      iteratorSeek(iterator, opts.gt);
      iteratorNext(iterator);
    } else if (opts.gte) {
      iteratorSeek(iterator, opts.gte);
    } else {
      iteratorSeekToFirst(iterator);
    }
    const bucket = opts.bucketId ?? BUCKET_ID_UNKNOWN;
    const metrics = this.metrics;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;
    return (async function* () {
      try {
        while (iteratorValid(iterator)) {
          const key = iteratorKey(iterator);
          if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
          if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
          itemsRead++;
          const value = iteratorValue(iterator);
          yield {key, value};
          iteratorNext(iterator);
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        iteratorDestroy(iterator);
      }
    })();
  }

  async entries(opts: FilterOptions<Uint8Array> = {}): Promise<KeyValue<Uint8Array, Uint8Array>[]> {
    const iterator = dbIterator(this.db);
    if (opts.gt) {
      iteratorSeek(iterator, opts.gt);
      iteratorNext(iterator);
    } else if (opts.gte) {
      iteratorSeek(iterator, opts.gte);
    } else {
      iteratorSeekToFirst(iterator);
    }
    const entries = [];
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    try {
      while (iteratorValid(iterator)) {
        const key = iteratorKey(iterator);
        if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
        if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
        const value = iteratorValue(iterator);
        entries.push({key, value});
        iteratorNext(iterator);
      }
      return entries;
    } finally {
      this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, entries.length);
      iteratorDestroy(iterator);
    }
  }
}
