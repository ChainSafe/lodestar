import {ChainForkConfig} from "@lodestar/config";
import {Type} from "@chainsafe/ssz";
import {BUCKET_LENGTH} from "./const.js";
import {FilterOptions, KeyValue} from "./controller/index.js";
import {Db, DbReqOpts} from "./controller/interface.js";
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
  protected config: ChainForkConfig;

  protected db: Db;

  protected bucket: Bucket;
  private readonly bucketId: string;
  private readonly dbReqOpts: DbReqOpts;

  private readonly minKey: Uint8Array;
  private readonly maxKey: Uint8Array;

  protected type: Type<T>;

  protected constructor(config: ChainForkConfig, db: Db, bucket: Bucket, type: Type<T>) {
    this.config = config;
    this.db = db;
    this.bucket = bucket;
    this.bucketId = getBucketNameByValue(bucket);
    this.dbReqOpts = {bucketId: this.bucketId};
    this.type = type;
    this.minKey = _encodeKey(bucket, Buffer.alloc(0));
    this.maxKey = _encodeKey(bucket + 1, Buffer.alloc(0));
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
    const value = await this.db.get(this.encodeKey(id), this.dbReqOpts);
    if (!value) return null;
    return this.decodeValue(value);
  }

  async getBinary(id: I): Promise<Uint8Array | null> {
    const value = await this.db.get(this.encodeKey(id), this.dbReqOpts);
    if (!value) return null;
    return value;
  }

  async has(id: I): Promise<boolean> {
    return (await this.get(id)) !== null;
  }

  async put(id: I, value: T): Promise<void> {
    await this.db.put(this.encodeKey(id), this.encodeValue(value), this.dbReqOpts);
  }

  async putBinary(id: I, value: Uint8Array): Promise<void> {
    await this.db.put(this.encodeKey(id), value, this.dbReqOpts);
  }

  async delete(id: I): Promise<void> {
    await this.db.delete(this.encodeKey(id), this.dbReqOpts);
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

  async batchPut(items: KeyValue<I, T>[]): Promise<void> {
    await this.db.batchPut(
      Array.from({length: items.length}, (_, i) => ({
        key: this.encodeKey(items[i].key),
        value: this.encodeValue(items[i].value),
      })),
      this.dbReqOpts
    );
  }

  // Similar to batchPut but we support value as Uint8Array
  async batchPutBinary(items: KeyValue<I, Uint8Array>[]): Promise<void> {
    await this.db.batchPut(
      Array.from({length: items.length}, (_, i) => ({
        key: this.encodeKey(items[i].key),
        value: items[i].value,
      })),
      this.dbReqOpts
    );
  }

  async batchDelete(ids: I[]): Promise<void> {
    await this.db.batchDelete(
      Array.from({length: ids.length}, (_, i) => this.encodeKey(ids[i])),
      this.dbReqOpts
    );
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

  async keys(opts?: FilterOptions<I>): Promise<I[]> {
    const data = await this.db.keys(this.dbFilterOptions(opts));
    return (data ?? []).map((data) => this.decodeKey(data));
  }

  async *keysStream(opts?: FilterOptions<I>): AsyncIterable<I> {
    const keysStream = this.db.keysStream(this.dbFilterOptions(opts));
    const decodeKey = this.decodeKey.bind(this);
    for await (const key of keysStream) {
      yield decodeKey(key);
    }
  }

  async values(opts?: FilterOptions<I>): Promise<T[]> {
    const data = await this.db.values(this.dbFilterOptions(opts));
    return (data ?? []).map((data) => this.decodeValue(data));
  }

  async *valuesStream(opts?: FilterOptions<I>): AsyncIterable<T> {
    const valuesStream = this.db.valuesStream(this.dbFilterOptions(opts));
    const decodeValue = this.decodeValue.bind(this);
    for await (const value of valuesStream) {
      yield decodeValue(value);
    }
  }

  async *binaryEntriesStream(opts?: FilterOptions<I>): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    yield* this.db.entriesStream(this.dbFilterOptions(opts));
  }

  async entries(opts?: FilterOptions<I>): Promise<KeyValue<I, T>[]> {
    const data = await this.db.entries(this.dbFilterOptions(opts));
    return (data ?? []).map((data) => ({
      key: this.decodeKey(data.key),
      value: this.decodeValue(data.value),
    }));
  }

  async *entriesStream(opts?: FilterOptions<I>): AsyncIterable<KeyValue<I, T>> {
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
    // Metrics accounted in this.keys()
    const keys = await this.keys({limit: 1, bucketId: this.bucketId});
    if (!keys.length) {
      return null;
    }
    return keys[0];
  }

  async lastKey(): Promise<I | null> {
    // Metrics accounted in this.keys()
    const keys = await this.keys({limit: 1, reverse: true, bucketId: this.bucketId});
    if (!keys.length) {
      return null;
    }
    return keys[0];
  }

  async firstValue(): Promise<T | null> {
    // Metrics accounted in this.values()
    const values = await this.values({limit: 1, bucketId: this.bucketId});
    if (!values.length) {
      return null;
    }
    return values[0];
  }

  async lastValue(): Promise<T | null> {
    // Metrics accounted in this.values()
    const values = await this.values({limit: 1, reverse: true, bucketId: this.bucketId});
    if (!values.length) {
      return null;
    }
    return values[0];
  }

  async firstEntry(): Promise<KeyValue<I, T> | null> {
    // Metrics accounted in this.entries()
    const entries = await this.entries({limit: 1, bucketId: this.bucketId});
    if (!entries.length) {
      return null;
    }
    return entries[0];
  }

  async lastEntry(): Promise<KeyValue<I, T> | null> {
    // Metrics accounted in this.entries()
    const entries = await this.entries({limit: 1, reverse: true, bucketId: this.bucketId});
    if (!entries.length) {
      return null;
    }
    return entries[0];
  }

  /**
   * Transforms opts from I to Uint8Array
   */
  protected dbFilterOptions(opts?: FilterOptions<I>): FilterOptions<Uint8Array> {
    const optsBuff: FilterOptions<Uint8Array> = {
      bucketId: this.bucketId,
    };

    // Set at least one min key
    if (opts?.lt !== undefined) {
      optsBuff.lt = this.encodeKey(opts.lt);
    } else if (opts?.lte !== undefined) {
      optsBuff.lte = this.encodeKey(opts.lte);
    } else {
      optsBuff.lt = this.maxKey;
    }

    // Set at least on max key
    if (opts?.gt !== undefined) {
      optsBuff.gt = this.encodeKey(opts.gt);
    } else if (opts?.gte !== undefined) {
      optsBuff.gte = this.encodeKey(opts.gte);
    } else {
      optsBuff.gte = this.minKey;
    }

    if (opts?.reverse !== undefined) optsBuff.reverse = opts.reverse;
    if (opts?.limit !== undefined) optsBuff.limit = opts.limit;

    return optsBuff;
  }
}
