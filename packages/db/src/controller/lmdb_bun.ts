import {
  Database,
  Environment,
  cursorDeinit,
  cursorGetCurrentValue,
  cursorGoToFirst,
  cursorGoToNext,
  cursorSeek,
  databaseCursor,
  databaseDelete,
  databaseGet,
  databaseOpen,
  databaseSet,
  environmentDeinit,
  environmentInit,
  transactionAbort,
  transactionBegin,
  transactionCommit,
} from "@lodestar/bun";
import {Logger} from "@lodestar/utils";
import {DatabaseController, DatabaseOptions, DbReqOpts, FilterOptions, KeyValue} from "./interface.ts";
import {LevelDbControllerMetrics} from "./metrics.ts";

export type LmdbControllerModules = {
  logger: Logger;
  metrics?: LevelDbControllerMetrics | null;
};

export enum Status {
  started = "started",
  closed = "closed",
}

const BUCKET_ID_UNKNOWN = "unknown";

export class LmdbController implements DatabaseController<Uint8Array, Uint8Array> {
  private status = Status.started;

  constructor(
    private readonly db: Environment,
    private metrics: LevelDbControllerMetrics | null
  ) {}

  static async create(options: DatabaseOptions, {metrics}: LmdbControllerModules): Promise<LmdbController> {
    const db = environmentInit(options.name);
    return new LmdbController(db, metrics ?? null);
  }

  static async destroy(_location: string): Promise<void> {
    // not implemented
  }

  async close(): Promise<void> {
    if (this.status === Status.closed) {
      return;
    }
    this.status = Status.closed;

    environmentDeinit(this.db);
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
    const tx = transactionBegin(this.db);
    const db = databaseOpen(tx, null);

    const raw = databaseGet(tx, db, key);
    const value = raw ? raw.slice() : null;

    transactionAbort(tx);

    return value;
  }

  async getMany(keys: Uint8Array[], opts?: DbReqOpts): Promise<(Uint8Array | undefined)[]> {
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);

    const tx = transactionBegin(this.db);
    const db = databaseOpen(tx, null);

    const values = [];
    for (const key of keys) {
      const raw = databaseGet(tx, db, key);
      values.push(raw ? raw.slice() : undefined);
    }
    transactionAbort(tx);

    return values;
  }

  async put(key: Uint8Array, value: Uint8Array, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);

    const tx = transactionBegin(this.db, false);
    const db = databaseOpen(tx, null);

    databaseSet(tx, db, key, value);

    transactionCommit(tx);
  }

  async delete(key: Uint8Array, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);

    const tx = transactionBegin(this.db, false);
    const db = databaseOpen(tx, null);

    databaseDelete(tx, db, key);

    transactionCommit(tx);
  }

  async batchPut(items: KeyValue<Uint8Array, Uint8Array>[], opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, items.length);

    const tx = transactionBegin(this.db, false);
    const db = databaseOpen(tx, null);

    for (const {key, value} of items) {
      databaseSet(tx, db, key, value);
    }

    transactionCommit(tx);
  }

  async batchDelete(keys: Uint8Array[], opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);

    const tx = transactionBegin(this.db, false);
    const db = databaseOpen(tx, null);

    for (const key of keys) {
      databaseDelete(tx, db, key);
    }

    transactionCommit(tx);
  }

  keysStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    const tx = transactionBegin(this.db);
    const db = databaseOpen(tx, null);

    const iterator = databaseCursor(tx, db);

    const metrics = this.metrics;
    const bucket = opts.bucketId ?? BUCKET_ID_UNKNOWN;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;

    return (async function* () {
      try {
        if (opts.gt) {
          cursorSeek(iterator, opts.gt);
          const first = cursorGoToNext(iterator);
          if (!first) return;
          itemsRead++;
          yield first.slice();
        } else if (opts.gte) {
          const first = cursorSeek(iterator, opts.gte);
          if (!first) return;
          itemsRead++;
          yield first.slice();
        } else {
          const first = cursorGoToFirst(iterator);
          if (!first) return;
          itemsRead++;
          yield first.slice();
        }

        while (true) {
          const key = cursorGoToNext(iterator);
          if (!key) return;
          if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
          if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
          itemsRead++;
          yield key.slice();
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        cursorDeinit(iterator);
        transactionAbort(tx);
      }
    })();
  }

  async keys(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    const tx = transactionBegin(this.db);
    const db = databaseOpen(tx, null);
    const iterator = databaseCursor(tx, db);
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    const keys: Uint8Array[] = [];
    try {
      if (opts.gt) {
        cursorSeek(iterator, opts.gt);
        const first = cursorGoToNext(iterator);
        if (!first) return keys;
        keys.push(first.slice());
      } else if (opts.gte) {
        const first = cursorSeek(iterator, opts.gte);
        if (!first) return keys;
        keys.push(first.slice());
      } else {
        const first = cursorGoToFirst(iterator);
        if (!first) return keys;
        keys.push(first.slice());
      }
      while (true) {
        const key = cursorGoToNext(iterator);
        if (!key) break;
        if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
        if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
        keys.push(key.slice());
      }
      return keys;
    } finally {
      this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);
      cursorDeinit(iterator);
      transactionAbort(tx);
    }
  }

  valuesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<Uint8Array> {
    const tx = transactionBegin(this.db);
    const db = databaseOpen(tx, null);
    const iterator = databaseCursor(tx, db);
    const bucket = opts.bucketId ?? BUCKET_ID_UNKNOWN;
    const metrics = this.metrics;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;
    return (async function* () {
      try {
        if (opts.gt) {
          cursorSeek(iterator, opts.gt);
          const first = cursorGoToNext(iterator);
          if (!first) return;
          const value = cursorGetCurrentValue(iterator);
          itemsRead++;
          yield value.slice();
        } else if (opts.gte) {
          const first = cursorSeek(iterator, opts.gte);
          if (!first) return;
          const value = cursorGetCurrentValue(iterator);
          itemsRead++;
          yield value.slice();
        } else {
          const first = cursorGoToFirst(iterator);
          if (!first) return;
          const value = cursorGetCurrentValue(iterator);
          itemsRead++;
          yield value.slice();
        }
        while (true) {
          const key = cursorGoToNext(iterator);
          if (!key) return;
          if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
          if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
          const value = cursorGetCurrentValue(iterator);
          itemsRead++;
          yield value.slice();
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        cursorDeinit(iterator);
        transactionAbort(tx);
      }
    })();
  }

  async values(opts: FilterOptions<Uint8Array> = {}): Promise<Uint8Array[]> {
    const tx = transactionBegin(this.db);
    const db = databaseOpen(tx, null);
    const iterator = databaseCursor(tx, db);
    const values: Uint8Array[] = [];
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    try {
      if (opts.gt) {
        cursorSeek(iterator, opts.gt);
        const first = cursorGoToNext(iterator);
        if (!first) return values;
        const value = cursorGetCurrentValue(iterator);
        values.push(value.slice());
      } else if (opts.gte) {
        const first = cursorSeek(iterator, opts.gte);
        if (!first) return values;
        const value = cursorGetCurrentValue(iterator);
        values.push(value.slice());
      } else {
        const first = cursorGoToFirst(iterator);
        if (!first) return values;
        const value = cursorGetCurrentValue(iterator);
        values.push(value.slice());
      }
      while (true) {
        const key = cursorGoToNext(iterator);
        if (!key) break;
        if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
        if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
        const value = cursorGetCurrentValue(iterator);
        values.push(value.slice());
      }
      return values;
    } finally {
      this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, values.length);
      cursorDeinit(iterator);
      transactionAbort(tx);
    }
  }

  entriesStream(opts: FilterOptions<Uint8Array> = {}): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    const tx = transactionBegin(this.db);
    const db = databaseOpen(tx, null);
    const iterator = databaseCursor(tx, db);
    const bucket = opts.bucketId ?? BUCKET_ID_UNKNOWN;
    const metrics = this.metrics;
    metrics?.dbReadReq.inc({bucket}, 1);
    let itemsRead = 0;
    return (async function* () {
      try {
        if (opts.gt) {
          cursorSeek(iterator, opts.gt);
          const first = cursorGoToNext(iterator);
          if (!first) return;
          const value = cursorGetCurrentValue(iterator);
          itemsRead++;
          yield {key: first.slice(), value: value.slice()};
        } else if (opts.gte) {
          const first = cursorSeek(iterator, opts.gte);
          if (!first) return;
          const value = cursorGetCurrentValue(iterator);
          itemsRead++;
          yield {key: first.slice(), value: value.slice()};
        } else {
          const first = cursorGoToFirst(iterator);
          if (!first) return;
          const value = cursorGetCurrentValue(iterator);
          itemsRead++;
          yield {key: first.slice(), value: value.slice()};
        }
        while (true) {
          const key = cursorGoToNext(iterator);
          if (!key) return;
          if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
          if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
          const value = cursorGetCurrentValue(iterator);
          itemsRead++;
          yield {key: key.slice(), value: value.slice()};
        }
      } finally {
        metrics?.dbReadItems.inc({bucket}, itemsRead);
        cursorDeinit(iterator);
        transactionAbort(tx);
      }
    })();
  }

  async entries(opts: FilterOptions<Uint8Array> = {}): Promise<KeyValue<Uint8Array, Uint8Array>[]> {
    const tx = transactionBegin(this.db);
    const db = databaseOpen(tx, null);
    const iterator = databaseCursor(tx, db);
    const entries: KeyValue<Uint8Array, Uint8Array>[] = [];
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    try {
      if (opts.gt) {
        cursorSeek(iterator, opts.gt);
        const first = cursorGoToNext(iterator);
        if (!first) return entries;
        const value = cursorGetCurrentValue(iterator);
        entries.push({key: first.slice(), value: value.slice()});
      } else if (opts.gte) {
        const first = cursorSeek(iterator, opts.gte);
        if (!first) return entries;
        const value = cursorGetCurrentValue(iterator);
        entries.push({key: first.slice(), value: value.slice()});
      } else {
        const first = cursorGoToFirst(iterator);
        if (!first) return entries;
        const value = cursorGetCurrentValue(iterator);
        entries.push({key: first.slice(), value: value.slice()});
      }
      while (true) {
        const key = cursorGoToNext(iterator);
        if (!key) break;
        if (opts.lt && Buffer.compare(key, opts.lt) >= 0) break;
        if (opts.lte && Buffer.compare(key, opts.lte) > 0) break;
        const value = cursorGetCurrentValue(iterator);
        entries.push({key: key.slice(), value: value.slice()});
      }
      return entries;
    } finally {
      this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, entries.length);
      cursorDeinit(iterator);
      transactionAbort(tx);
    }
  }
}
