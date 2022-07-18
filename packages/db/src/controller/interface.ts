import {ILevelDbControllerMetrics} from "./metrics.js";

/** Shortcut for Uint8Array based IDatabaseController */
export type Db = IDatabaseController<Uint8Array, Uint8Array>;

export interface IDatabaseOptions {
  name: string;
}

export interface IFilterOptions<K> {
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
  /** For metrics */
  bucketId?: string;
};

export interface IKeyValue<K, V> {
  key: K;
  value: V;
}

export interface IDatabaseController<K, V> {
  // service start / stop

  start(): Promise<void>;
  stop(): Promise<void>;

  /** To inject metrics after CLI initialization */
  setMetrics(metrics: ILevelDbControllerMetrics): void;

  // Core API

  get(key: K, opts?: DbReqOpts): Promise<V | null>;
  put(key: K, value: V, opts?: DbReqOpts): Promise<void>;
  delete(key: K, opts?: DbReqOpts): Promise<void>;

  // Batch operations

  batchPut(items: IKeyValue<K, V>[], opts?: DbReqOpts): Promise<void>;
  batchDelete(keys: K[], opts?: DbReqOpts): Promise<void>;

  // Iterate over entries

  keysStream(opts?: IFilterOptions<K>): AsyncIterable<K>;
  keys(opts?: IFilterOptions<K>): Promise<K[]>;

  valuesStream(opts?: IFilterOptions<K>): AsyncIterable<V>;
  values(opts?: IFilterOptions<K>): Promise<V[]>;

  entriesStream(opts?: IFilterOptions<K>): AsyncIterable<IKeyValue<K, V>>;
  entries(opts?: IFilterOptions<K>): Promise<IKeyValue<K, V>[]>;
}
