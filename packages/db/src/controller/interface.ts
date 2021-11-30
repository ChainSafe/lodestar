/**
 * @module db/controller
 */

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
}
export interface IKeyValue<K, V> {
  key: K;
  value: V;
}

export interface IDatabaseController<K, V> {
  // service start / stop

  start(): Promise<void>;
  stop(): Promise<void>;

  // Core API

  get(key: K): Promise<V | null>;
  put(key: K, value: V): Promise<void>;
  delete(key: K): Promise<void>;

  // Batch operations

  batchPut(items: IKeyValue<K, V>[]): Promise<void>;
  batchDelete(keys: K[]): Promise<void>;

  // Iterate over entries

  keysStream(opts?: IFilterOptions<K>): AsyncIterable<K>;
  keys(opts?: IFilterOptions<K>): Promise<K[]>;

  valuesStream(opts?: IFilterOptions<K>): AsyncIterable<V>;
  values(opts?: IFilterOptions<K>): Promise<V[]>;

  entriesStream(opts?: IFilterOptions<K>): AsyncIterable<IKeyValue<K, V>>;
  entries(opts?: IFilterOptions<K>): Promise<IKeyValue<K, V>[]>;
}
