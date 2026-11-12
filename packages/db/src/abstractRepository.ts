import {Type} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH} from "./const.js";
import {FilterOptions, KeyValue} from "./controller/index.js";
import {Db, DbBatch, DbReqOpts} from "./controller/interface.js";
import {encodeKey as _encodeKey} from "./util.js";

export type Id = Uint8Array | string | number | bigint;

/**
 * BinaryRepository is a high level kv storage
 * managing a Uint8Array to Uint8Array kv database
 * It translates typed keys and Uint8Array values required by the underlying database
 */
export abstract class BinaryRepository<I extends Id> {
  protected readonly dbReqOpts: DbReqOpts;

  protected readonly minKey: Uint8Array;
  protected readonly maxKey: Uint8Array;

  protected constructor(
    protected config: ChainForkConfig,
    protected db: Db,
    protected bucket: number,
    protected readonly bucketId: string
  ) {
    this.dbReqOpts = {bucketId: this.bucketId};
    this.minKey = _encodeKey(bucket, Buffer.alloc(0));
    this.maxKey = _encodeKey(bucket + 1, Buffer.alloc(0));
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

  encodeKey(id: I): Uint8Array {
    return _encodeKey(this.bucket, id);
  }

  decodeKey(key: Uint8Array): I {
    return key.slice(BUCKET_LENGTH) as I;
  }

  async getBinary(id: I): Promise<Uint8Array | null> {
    const value = await this.db.get(this.encodeKey(id), this.dbReqOpts);
    if (!value) return null;
    return value;
  }

  async putBinary(id: I, value: Uint8Array): Promise<void> {
    await this.db.put(this.encodeKey(id), value, this.dbReqOpts);
  }

  async binaries(opts?: FilterOptions<I>): Promise<Uint8Array[]> {
    const data = await this.db.values(this.dbFilterOptions(opts));
    return data ?? [];
  }

  async lastBinary(): Promise<Uint8Array | null> {
    // Metrics accounted in this.values()
    const binaryValues = await this.binaries({limit: 1, reverse: true, bucketId: this.bucketId});
    if (!binaryValues.length) {
      return null;
    }
    return binaryValues[0];
  }

  // Similar to batchPut but we support value as Uint8Array
  async batchPutBinary(items: KeyValue<I, Uint8Array>[]): Promise<void> {
    if (items.length === 1) {
      return this.db.put(this.encodeKey(items[0].key), items[0].value, this.dbReqOpts);
    }

    await this.db.batchPut(
      Array.from({length: items.length}, (_, i) => ({
        key: this.encodeKey(items[i].key),
        value: items[i].value,
      })),
      this.dbReqOpts
    );
  }

  async *binaryEntriesStream(opts?: FilterOptions<I>): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    yield* this.db.entriesStream(this.dbFilterOptions(opts));
  }

  async has(id: I): Promise<boolean> {
    return (await this.getBinary(id)) !== null;
  }

  async delete(id: I): Promise<void> {
    await this.db.delete(this.encodeKey(id), this.dbReqOpts);
  }

  async batchDelete(ids: I[]): Promise<void> {
    if (ids.length === 1) {
      return this.delete(ids[0]);
    }

    await this.db.batchDelete(
      Array.from({length: ids.length}, (_, i) => this.encodeKey(ids[i])),
      this.dbReqOpts
    );
  }

  async batchBinary(batch: DbBatch<I, Uint8Array>): Promise<void> {
    const batchWithKeys: DbBatch<Uint8Array, Uint8Array> = [];
    for (const b of batch) {
      batchWithKeys.push({...b, key: this.encodeKey(b.key)});
    }
    await this.db.batch(batchWithKeys, this.dbReqOpts);
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

    // Set at least one max key
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

/**
 * Repository is a high level kv storage
 * managing a Uint8Array to Uint8Array kv database
 * It translates typed keys and values to Uint8Arrays required by the underlying database
 *
 * By default, SSZ-encoded values,
 * indexed by root
 */
export abstract class Repository<I extends Id, T> extends BinaryRepository<I> {
  protected constructor(
    config: ChainForkConfig,
    db: Db,
    bucket: number,
    protected type: Type<T>,
    bucketId: string
  ) {
    super(config, db, bucket, bucketId);
    this.type = type;
  }

  encodeValue(value: T): Uint8Array {
    return this.type.serialize(value);
  }

  decodeValue(data: Uint8Array): T {
    return this.type.deserialize(data);
  }

  async get(id: I): Promise<T | null> {
    const value = await this.db.get(this.encodeKey(id), this.dbReqOpts);
    if (!value) return null;
    return this.decodeValue(value);
  }

  async put(id: I, value: T): Promise<void> {
    await this.db.put(this.encodeKey(id), this.encodeValue(value), this.dbReqOpts);
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
    if (items.length === 1) {
      return this.put(items[0].key, items[0].value);
    }

    await this.db.batchPut(
      Array.from({length: items.length}, (_, i) => ({
        key: this.encodeKey(items[i].key),
        value: this.encodeValue(items[i].value),
      })),
      this.dbReqOpts
    );
  }

  async batch(batch: DbBatch<I, T>): Promise<void> {
    const batchWithKeys: DbBatch<Uint8Array, Uint8Array> = [];
    for (const b of batch) {
      if (b.type === "del") {
        batchWithKeys.push({...b, key: this.encodeKey(b.key)});
      } else {
        batchWithKeys.push({...b, key: this.encodeKey(b.key), value: this.encodeValue(b.value)});
      }
    }
    await this.db.batch(batchWithKeys, this.dbReqOpts);
  }

  async batchAdd(values: T[]): Promise<void> {
    // handle single value in batchPut
    await this.batchPut(
      Array.from({length: values.length}, (_, i) => ({
        key: this.getId(values[i]),
        value: values[i],
      }))
    );
  }

  async batchRemove(values: T[]): Promise<void> {
    // handle single value in batchDelete
    await this.batchDelete(Array.from({length: values.length}, (_ignored, i) => this.getId(values[i])));
  }

  async values(opts?: FilterOptions<I>): Promise<T[]> {
    const data = await this.binaries(opts);
    return (data ?? []).map((data) => this.decodeValue(data));
  }

  async *valuesStream(opts?: FilterOptions<I>): AsyncIterable<T> {
    const valuesStream = this.db.valuesStream(this.dbFilterOptions(opts));
    const decodeValue = this.decodeValue.bind(this);
    for await (const value of valuesStream) {
      yield decodeValue(value);
    }
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
}
