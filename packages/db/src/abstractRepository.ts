import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Type} from "@chainsafe/ssz";
import {BUCKET_LENGTH} from "./const.js";
import {IFilterOptions, IKeyValue} from "./controller/index.js";
import {Db} from "./controller/interface.js";
import {DbMetricCounter, IDbMetrics} from "./metrics.js";
import {Bucket, encodeKey as _encodeKey} from "./schema.js";
import {getBucketNameByValue} from "./util.js";

export type Id = Uint8Array | string | number | bigint;

/**
 * Repository is a high level kv storage
 * managing a Uint8Array to Uint8Array kv database
 * It translates typed keys and values to Uint8Arrays required by the underlying database
 *
 * By default, SSZ-encoded values,
 * indexed by root
 */
export abstract class Repository<I extends Id, T> {
  protected config: IChainForkConfig;

  protected db: Db;

  protected bucket: Bucket;

  protected type: Type<T>;

  protected dbReadsMetrics?: ReturnType<DbMetricCounter["labels"]>;
  protected dbWriteMetrics?: ReturnType<DbMetricCounter["labels"]>;

  protected constructor(config: IChainForkConfig, db: Db, bucket: Bucket, type: Type<T>, metrics?: IDbMetrics) {
    this.config = config;
    this.db = db;
    this.bucket = bucket;
    this.type = type;
    this.dbReadsMetrics = metrics?.dbReads.labels({bucket: getBucketNameByValue(bucket)});
    this.dbWriteMetrics = metrics?.dbWrites.labels({bucket: getBucketNameByValue(bucket)});
  }

  encodeValue(value: T): Uint8Array {
    return this.type.serialize(value);
  }

  decodeValue(data: Uint8Array): T {
    return this.type.deserialize(data);
  }

  encodeKey(id: I): Uint8Array {
    return _encodeKey(this.bucket, id);
  }

  decodeKey(key: Uint8Array): I {
    return key.slice(BUCKET_LENGTH) as I;
  }

  async get(id: I): Promise<T | null> {
    this.dbReadsMetrics?.inc();
    const value = await this.db.get(this.encodeKey(id));
    if (!value) return null;
    return this.decodeValue(value);
  }

  async getBinary(id: I): Promise<Uint8Array | null> {
    this.dbReadsMetrics?.inc();
    const value = await this.db.get(this.encodeKey(id));
    if (!value) return null;
    return value;
  }

  async has(id: I): Promise<boolean> {
    return (await this.get(id)) !== null;
  }

  async put(id: I, value: T): Promise<void> {
    this.dbWriteMetrics?.inc();
    await this.db.put(this.encodeKey(id), this.encodeValue(value));
  }

  async putBinary(id: I, value: Uint8Array): Promise<void> {
    this.dbWriteMetrics?.inc();
    await this.db.put(this.encodeKey(id), value);
  }

  async delete(id: I): Promise<void> {
    this.dbWriteMetrics?.inc();
    await this.db.delete(this.encodeKey(id));
  }

  // The Id can be inferred from the value
  getId(value: T): I {
    return this.type.hashTreeRoot(value) as I;
  }

  async add(value: T): Promise<void> {
    await this.put(this.getId(value), value);
  }

  async remove(value: T): Promise<void> {
    await this.delete(this.getId(value));
  }

  async batchPut(items: IKeyValue<I, T>[]): Promise<void> {
    this.dbWriteMetrics?.inc();
    await this.db.batchPut(
      Array.from({length: items.length}, (_, i) => ({
        key: this.encodeKey(items[i].key),
        value: this.encodeValue(items[i].value),
      }))
    );
  }

  // Similar to batchPut but we support value as Uint8Array
  async batchPutBinary(items: IKeyValue<I, Uint8Array>[]): Promise<void> {
    this.dbWriteMetrics?.inc();
    await this.db.batchPut(
      Array.from({length: items.length}, (_, i) => ({
        key: this.encodeKey(items[i].key),
        value: items[i].value,
      }))
    );
  }

  async batchDelete(ids: I[]): Promise<void> {
    this.dbWriteMetrics?.inc();
    await this.db.batchDelete(Array.from({length: ids.length}, (_, i) => this.encodeKey(ids[i])));
  }

  async batchAdd(values: T[]): Promise<void> {
    await this.batchPut(
      Array.from({length: values.length}, (_, i) => ({
        key: this.getId(values[i]),
        value: values[i],
      }))
    );
  }

  async batchRemove(values: T[]): Promise<void> {
    await this.batchDelete(Array.from({length: values.length}, (ignored, i) => this.getId(values[i])));
  }

  async keys(opts?: IFilterOptions<I>): Promise<I[]> {
    this.dbReadsMetrics?.inc();
    const data = await this.db.keys(this.dbFilterOptions(opts));
    return (data ?? []).map((data) => this.decodeKey(data));
  }

  async *keysStream(opts?: IFilterOptions<I>): AsyncIterable<I> {
    this.dbReadsMetrics?.inc();
    const keysStream = this.db.keysStream(this.dbFilterOptions(opts));
    const decodeKey = this.decodeKey.bind(this);
    for await (const key of keysStream) {
      yield decodeKey(key);
    }
  }

  async values(opts?: IFilterOptions<I>): Promise<T[]> {
    this.dbReadsMetrics?.inc();
    const data = await this.db.values(this.dbFilterOptions(opts));
    return (data ?? []).map((data) => this.decodeValue(data));
  }

  async *valuesStream(opts?: IFilterOptions<I>): AsyncIterable<T> {
    this.dbReadsMetrics?.inc();
    const valuesStream = this.db.valuesStream(this.dbFilterOptions(opts));
    const decodeValue = this.decodeValue.bind(this);
    for await (const value of valuesStream) {
      yield decodeValue(value);
    }
  }

  async *binaryEntriesStream(opts?: IFilterOptions<I>): AsyncIterable<IKeyValue<Uint8Array, Uint8Array>> {
    this.dbReadsMetrics?.inc();
    yield* this.db.entriesStream(this.dbFilterOptions(opts));
  }

  async entries(opts?: IFilterOptions<I>): Promise<IKeyValue<I, T>[]> {
    this.dbReadsMetrics?.inc();
    const data = await this.db.entries(this.dbFilterOptions(opts));
    return (data ?? []).map((data) => ({
      key: this.decodeKey(data.key),
      value: this.decodeValue(data.value),
    }));
  }

  async *entriesStream(opts?: IFilterOptions<I>): AsyncIterable<IKeyValue<I, T>> {
    this.dbReadsMetrics?.inc();
    const entriesStream = this.db.entriesStream(this.dbFilterOptions(opts));
    const decodeKey = this.decodeKey.bind(this);
    const decodeValue = this.decodeValue.bind(this);
    for await (const entry of entriesStream) {
      yield {
        key: decodeKey(entry.key),
        value: decodeValue(entry.value),
      };
    }
  }

  async firstKey(): Promise<I | null> {
    this.dbReadsMetrics?.inc();
    const keys = await this.keys({limit: 1});
    if (!keys.length) {
      return null;
    }
    return keys[0];
  }

  async lastKey(): Promise<I | null> {
    this.dbReadsMetrics?.inc();
    const keys = await this.keys({limit: 1, reverse: true});
    if (!keys.length) {
      return null;
    }
    return keys[0];
  }

  async firstValue(): Promise<T | null> {
    this.dbReadsMetrics?.inc();
    const values = await this.values({limit: 1});
    if (!values.length) {
      return null;
    }
    return values[0];
  }

  async lastValue(): Promise<T | null> {
    this.dbReadsMetrics?.inc();
    const values = await this.values({limit: 1, reverse: true});
    if (!values.length) {
      return null;
    }
    return values[0];
  }

  async firstEntry(): Promise<IKeyValue<I, T> | null> {
    this.dbReadsMetrics?.inc();
    const entries = await this.entries({limit: 1});
    if (!entries.length) {
      return null;
    }
    return entries[0];
  }

  async lastEntry(): Promise<IKeyValue<I, T> | null> {
    this.dbReadsMetrics?.inc();
    const entries = await this.entries({limit: 1, reverse: true});
    if (!entries.length) {
      return null;
    }
    return entries[0];
  }

  /**
   * Transforms opts from I to Uint8Array
   */
  protected dbFilterOptions(opts?: IFilterOptions<I>): IFilterOptions<Uint8Array> {
    const _opts: IFilterOptions<Uint8Array> = {
      gte: _encodeKey(this.bucket, Buffer.alloc(0)),
      lt: _encodeKey(this.bucket + 1, Buffer.alloc(0)),
    };
    if (opts) {
      if (opts.lt !== undefined) {
        _opts.lt = this.encodeKey(opts.lt);
      } else if (opts.lte !== undefined) {
        delete _opts.lt;
        _opts.lte = this.encodeKey(opts.lte);
      }
      if (opts.gt !== undefined) {
        delete _opts.gte;
        _opts.gt = this.encodeKey(opts.gt);
      } else if (opts.gte !== undefined) {
        _opts.gte = this.encodeKey(opts.gte);
      }
      _opts.reverse = opts.reverse;
      _opts.limit = opts.limit;
    }
    return _opts;
  }
}
