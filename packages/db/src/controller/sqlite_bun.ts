import {Database} from "bun:sqlite";
import {Logger} from "@lodestar/utils";
import {
  ControllerFilterOptions,
  DatabaseController,
  DatabaseOptions,
  DbReqOpts,
  FilterOptions,
  KeyValue,
} from "./interface.js";
import {LevelDbControllerMetrics} from "./metrics.js";

enum Status {
  started = "started",
  closed = "closed",
}

export type SqliteControllerModules = {
  logger: Logger;
  metrics?: LevelDbControllerMetrics | null;
};

/**
 * The Bun SQLite implementation of DB
 *
 * - `opts.bucketId` is NOT just used for metrics, it is required
 * - Each bucket is a separate table
 * (key BLOB PRIMARY KEY, value BLOB)
 * - `createTables` MUST be called first before any queries
 */
export class SqliteController implements DatabaseController<Uint8Array, Uint8Array> {
  private status = Status.started;

  private dbSizeMetricInterval?: NodeJS.Timeout;

  constructor(
    private readonly logger: Logger,
    private readonly db: Database,
    private metrics: LevelDbControllerMetrics | null
  ) {
    this.metrics = metrics ?? null;

    if (this.metrics) {
      this.collectDbSizeMetric();
    }
  }

  static create(opts: DatabaseOptions, {metrics, logger}: SqliteControllerModules): SqliteController {
    const db = new Database(opts.name || "beaconchain", {create: true, strict: true});

    // SQLite supports write-ahead log mode (WAL) which dramatically improves performance,
    // especially in situations with many concurrent readers and a single writer.
    // It's broadly recommended to enable WAL mode for most typical applications.
    // see https://bun.sh/docs/api/sqlite#wal-mode
    db.run("PRAGMA journal_mode = WAL;");

    return new SqliteController(logger, db, metrics ?? null);
  }

  async close(): Promise<void> {
    if (this.status === Status.closed) return;
    this.status = Status.closed;

    if (this.dbSizeMetricInterval) {
      clearInterval(this.dbSizeMetricInterval);
    }

    this.db.close();
  }

  createTables(bucketIds: string[]): void {
    for (const bucketId of bucketIds) {
      this.db.run(`CREATE TABLE IF NOT EXISTS ${bucketId} (key BLOB PRIMARY KEY, value BLOB)`);
    }
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
    throw new Error("unimplemented");
  }

  async get(key: Uint8Array, opts: DbReqOpts): Promise<Uint8Array | null> {
    this.metrics?.dbReadReq.inc({bucket: opts.bucketId}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts.bucketId}, 1);

    const query = this.db.query<{value: Uint8Array}, Uint8Array[]>(`SELECT value from ${opts.bucketId} WHERE key = ?1`);
    return query.get(key)?.value ?? null;
  }

  async getMany(key: Uint8Array[], opts: DbReqOpts): Promise<(Uint8Array | undefined)[]> {
    this.metrics?.dbReadReq.inc({bucket: opts.bucketId}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts.bucketId}, key.length);

    const query = this.db.query<{value: Uint8Array}, Uint8Array[]>(`SELECT value from ${opts.bucketId} WHERE key = ?1`);
    return key.map((k) => query.get(k)?.value ?? undefined);
  }

  async put(key: Uint8Array, value: Uint8Array, opts: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts.bucketId}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts.bucketId}, 1);

    const query = this.db.query(`INSERT OR REPLACE INTO ${opts.bucketId} VALUES (?1, ?2)`);
    query.run(key, value);
  }

  async delete(key: Uint8Array, opts: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts.bucketId}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts.bucketId}, 1);

    const query = this.db.query(`DELETE FROM ${opts.bucketId} WHERE key = ?1`);
    query.run(key);
  }

  async batchPut(items: KeyValue<Uint8Array, Uint8Array>[], opts: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts.bucketId}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts.bucketId}, items.length);

    const query = this.db.query(`INSERT OR REPLACE INTO ${opts.bucketId} VALUES (?1, ?2)`);

    const batch = this.db.transaction((items: KeyValue<Uint8Array, Uint8Array>[]) => {
      for (const {key, value} of items) {
        query.run(key, value);
      }
    });
    batch(items);
  }

  async batchDelete(keys: Uint8Array[], opts: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts.bucketId}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts.bucketId}, keys.length);

    const query = this.db.query(`DELETE FROM ${opts.bucketId} WHERE key = ?1`);

    const batch = this.db.transaction((keys: Uint8Array[]) => {
      for (const key of keys) {
        query.run(key);
      }
    });
    batch(keys);
  }

  keysStream(opts: ControllerFilterOptions<Uint8Array>): AsyncIterable<Uint8Array> {
    const query = this.db.query<{key: Uint8Array}, Uint8Array[]>(
      `SELECT key from ${opts.bucketId} ${filterOptsToClauses(opts)}`
    );
    const iterator = query.iterate(...filterOptsToParams(opts));
    return this.metricsIterator(iterator, (key) => key.key, opts.bucketId);
  }

  valuesStream(opts: ControllerFilterOptions<Uint8Array>): AsyncIterable<Uint8Array> {
    const query = this.db.query<{value: Uint8Array}, Uint8Array[]>(
      `SELECT value from ${opts.bucketId} ${filterOptsToClauses(opts)}`
    );
    const iterator = query.iterate(...filterOptsToParams(opts));
    return this.metricsIterator(iterator, (value) => value.value, opts.bucketId);
  }

  entriesStream(opts: ControllerFilterOptions<Uint8Array>): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    const query = this.db.query<{key: Uint8Array; value: Uint8Array}, Uint8Array[]>(
      `SELECT key, value from ${opts.bucketId} ${filterOptsToClauses(opts)}`
    );
    const iterator = query.iterate(...filterOptsToParams(opts));
    return this.metricsIterator(iterator, (entry) => entry, opts.bucketId);
  }

  async keys(opts: ControllerFilterOptions<Uint8Array>): Promise<Uint8Array[]> {
    const query = this.db.query<{key: Uint8Array}, Uint8Array[]>(
      `SELECT key from ${opts.bucketId} ${filterOptsToClauses(opts)}`
    );
    const items = query.values(...filterOptsToParams(opts)).flat() as Uint8Array[];
    return this.metricsAll(items, opts.bucketId);
  }

  async values(opts: ControllerFilterOptions<Uint8Array>): Promise<Uint8Array[]> {
    const query = this.db.query<{value: Uint8Array}, Uint8Array[]>(
      `SELECT value from ${opts.bucketId} ${filterOptsToClauses(opts)}`
    );
    const items = query.values(...filterOptsToParams(opts)).flat() as Uint8Array[];
    return this.metricsAll(items, opts.bucketId);
  }

  async entries(opts: ControllerFilterOptions<Uint8Array>): Promise<KeyValue<Uint8Array, Uint8Array>[]> {
    const query = this.db.query<{key: Uint8Array; value: Uint8Array}, Uint8Array[]>(
      `SELECT key, value from ${opts.bucketId} ${filterOptsToClauses(opts)}`
    );
    const items = query.all(...filterOptsToParams(opts));
    return this.metricsAll(items, opts.bucketId);
  }

  /**
   * Get the approximate number of bytes of file system space used by the range [start..end).
   * The result might not include recently written data.
   */
  approximateSize(_start: Uint8Array, _end: Uint8Array): Promise<number> {
    throw new Error("not implemented");
  }

  /**
   * Manually trigger a database compaction in the range [start..end].
   */
  compactRange(_start: Uint8Array, _end: Uint8Array): Promise<void> {
    throw new Error("not implemented");
  }

  /** Capture metrics for db.iterator, db.keys, db.values .all() calls */
  private metricsAll<T>(items: T[], bucket: string): T[] {
    this.metrics?.dbWriteReq.inc({bucket}, 1);
    this.metrics?.dbWriteItems.inc({bucket}, items.length);
    return items;
  }

  /** Capture metrics for db.iterator, db.keys, db.values AsyncIterable calls */
  private async *metricsIterator<T, K>(
    iterator: Iterable<T>,
    getValue: (item: T) => K,
    bucket: string
  ): AsyncIterable<K> {
    this.metrics?.dbWriteReq.inc({bucket}, 1);

    let itemsRead = 0;

    for (const item of iterator) {
      // Count metrics after done condition
      itemsRead++;

      yield getValue(item);
    }

    this.metrics?.dbWriteItems.inc({bucket}, itemsRead);
  }

  /** Start interval to capture metric for db size */
  private collectDbSizeMetric(): void {
    // TODO implement later
  }

  /** Capture metric for db size */
  private dbSizeMetric(): void {
    // TODO implement later
  }
}

// IMPORTANT NOTE: order of opts processing matches filterOptsToParams
function filterOptsToClauses(opts: FilterOptions<Uint8Array>): string {
  let clauses = "";
  let clauseIx = 1;
  if (opts.gt || opts.gte || opts.lt || opts.lte) {
    const whereClauses: string[] = [];
    if (opts.gt) whereClauses.push(`key > ?${clauseIx++}`);
    if (opts.gte) whereClauses.push(`key >= ?${clauseIx++}`);
    if (opts.lt) whereClauses.push(`key < ?${clauseIx++}`);
    if (opts.lte) whereClauses.push(`key <= ?${clauseIx++}`);
    clauses += `WHERE ${whereClauses.join(" AND ")} `;
  }
  if (opts.reverse) {
    clauses += "ORDER BY key DESC ";
  }
  if (opts.limit) {
    clauses += `LIMIT ${opts.limit} `;
  }
  return clauses;
}

// IMPORTANT NOTE: order of opts processing matches filterOptsToClauses
function filterOptsToParams(opts: FilterOptions<Uint8Array>): Uint8Array[] {
  const params: Uint8Array[] = [];
  if (opts.gt) params.push(opts.gt);
  if (opts.gte) params.push(opts.gte);
  if (opts.lt) params.push(opts.lt);
  if (opts.lte) params.push(opts.lte);
  return params;
}
