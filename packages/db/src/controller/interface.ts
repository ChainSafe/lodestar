import {LevelDbControllerMetrics} from "./metrics.js";

/** Shortcut for Uint8Array based DatabaseController */
export type Db = DatabaseController<Uint8Array, Uint8Array>;

export type DatabaseOptions = {
  name: string;
};

export type DbReadLimits = {
  maxKeyBytes: number;
  maxValueBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
};

export const DB_READ_LIMITS_V1 = Object.freeze({
  maxKeyBytes: 1024,
  maxValueBytes: 128 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxEntries: 1024,
  maxIteratorRows: 16384,
});

export interface FilterOptions<K> {
  readLimits?: DbReadLimits;
  /** Forwarded to classic-level; false keeps the blocks this read loads out of the LevelDB block cache */
  fillCache?: boolean;
  /** Read one row per native call, so a stream holds at most one row natively and one in JS */
  rowAtATime?: boolean;
  gt?: K;
  gte?: K;
  lt?: K;
  lte?: K;
  reverse?: boolean;
  limit?: number;
  /** For metrics */
  bucketId?: string;
}

export type DbReqOpts = {
  readLimits?: DbReadLimits;
  /** Forwarded to classic-level; false keeps the blocks this read loads out of the LevelDB block cache */
  fillCache?: boolean;
  /** For metrics */
  bucketId?: string;
};

export interface KeyValue<K, V> {
  key: K;
  value: V;
}

export type DbBatchOperation<K, V> = {type: "del"; key: K} | {type: "put"; key: K; value: V};
export type DbBatch<K, V> = DbBatchOperation<K, V>[];

export interface DatabaseController<K, V> {
  readonly boundedReadVersion?: 1;
  // service start / stop

  close(): Promise<void>;

  /** To inject metrics after CLI initialization */
  setMetrics(metrics: LevelDbControllerMetrics): void;

  // Core API

  get(key: K, opts?: DbReqOpts): Promise<V | null>;
  getMany(key: K[], opts?: DbReqOpts): Promise<(V | undefined)[]>;

  put(key: K, value: V, opts?: DbReqOpts): Promise<void>;
  delete(key: K, opts?: DbReqOpts): Promise<void>;

  // Batch operations

  batchPut(items: KeyValue<K, V>[], opts?: DbReqOpts): Promise<void>;
  batchDelete(keys: K[], opts?: DbReqOpts): Promise<void>;
  batch(batch: DbBatch<K, V>, opts?: DbReqOpts): Promise<void>;

  // Iterate over entries

  keysStream(opts?: FilterOptions<K>): AsyncIterable<K>;
  keys(opts?: FilterOptions<K>): Promise<K[]>;

  valuesStream(opts?: FilterOptions<K>): AsyncIterable<V>;
  values(opts?: FilterOptions<K>): Promise<V[]>;

  entriesStream(opts?: FilterOptions<K>): AsyncIterable<KeyValue<K, V>>;
  entries(opts?: FilterOptions<K>): Promise<KeyValue<K, V>[]>;
}
