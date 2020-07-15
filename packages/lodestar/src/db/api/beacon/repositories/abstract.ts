import {ArrayLike, Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController, IFilterOptions, IKeyValue} from "../../../controller";
import {Bucket, encodeKey as _encodeKey} from "../../schema";

export type Id = Uint8Array | string | number | bigint;

/**
 * Repository is a high level kv storage
 * managing a Buffer to Buffer kv database
 * It translates typed keys and values to Buffers required by the underlying database
 * 
 * By default, SSZ-encoded values,
 * indexed by root
 */
export abstract class Repository<I extends Id, T> {
  protected config: IBeaconConfig;

  protected db: IDatabaseController<Buffer, Buffer>;

  protected bucket: Bucket;

  protected type: Type<T>;

  protected constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
    bucket: Bucket,
    type: Type<T>) {
    this.config = config;
    this.db = db;
    this.bucket = bucket;
    this.type = type;
  }

  public encodeValue(value: T): Buffer {
    return this.type.serialize(value) as Buffer;
  }

  public decodeValue(data: Buffer): T {
    return this.type.deserialize(data);
  }

  public encodeKey(id: I): Buffer {
    return _encodeKey(this.bucket, id);
  }

  public decodeKey(key: Buffer): I {
    return key.slice(1) as Uint8Array as I;
  }

  public async get(id: I): Promise<T | null> {
    try {
      const value = await this.db.get(this.encodeKey(id));
      if(!value) return null;
      return this.decodeValue(value);
    } catch (e) {
      return null;
    }
  }

  public async has(id: I): Promise<boolean> {
    return await this.get(id) !== null;
  }

  public async put(id: I, value: T): Promise<void> {
    await this.db.put(this.encodeKey(id), this.encodeValue(value));
  }

  public async delete(id: I): Promise<void> {
    await this.db.delete(this.encodeKey(id));
  }

  // The Id can be inferred from the value
  public getId(value: T): I {
    return this.type.hashTreeRoot(value) as I;
  }

  public async add(value: T): Promise<void> {
    await this.put(this.getId(value), value);
  }

  public async remove(value: T): Promise<void> {
    await this.delete(this.getId(value));
  }

  public async batchPut(items: ArrayLike<IKeyValue<I, T>>): Promise<void> {
    await this.db.batchPut(Array.from({length: items.length}, (_, i) => ({
      key: this.encodeKey(items[i].key),
      value: this.encodeValue(items[i].value),
    })));
  }

  public async batchDelete(ids: ArrayLike<I>): Promise<void> {
    await this.db.batchDelete(Array.from({length: ids.length}, (_, i) => this.encodeKey(ids[i])));
  }

  public async batchAdd(values: ArrayLike<T>): Promise<void> {
    await this.batchPut(Array.from({length: values.length}, (_, i) => ({
      key: this.getId(values[i]),
      value: values[i],
    })));
  }

  public async batchRemove(values: ArrayLike<T>): Promise<void> {
    await this.batchDelete(Array.from({length: values.length}, (_, i) => this.getId(values[i])));
  }

  public async keys(opts?: IFilterOptions<I>): Promise<I[]> {
    const data = await this.db.keys(this.dbFilterOptions(opts));
    return (data || []).map((data) => this.decodeKey(data));
  }
  public keysStream(opts?: IFilterOptions<I>): AsyncIterable<I> {
    const keysStream = this.db.keysStream(this.dbFilterOptions(opts));
    const decodeKey = this.decodeKey.bind(this);
    return (async function * () {
      for await (const key of keysStream) {
        yield decodeKey(key);
      }
    })();
  }
  public async values(opts?: IFilterOptions<I>): Promise<T[]> {
    const data = await this.db.values(this.dbFilterOptions(opts));
    return (data || []).map((data) => this.decodeValue(data));
  }
  public valuesStream(opts?: IFilterOptions<I>): AsyncIterable<T> {
    const valuesStream = this.db.valuesStream(this.dbFilterOptions(opts));
    const decodeValue = this.decodeValue.bind(this);
    return (async function * () {
      for await (const value of valuesStream) {
        yield decodeValue(value);
      }
    })();
  }
  public async entries(opts?: IFilterOptions<I>): Promise<IKeyValue<I, T>[]> {
    const data = await this.db.entries(this.dbFilterOptions(opts));
    return (data || []).map((data) => ({
      key: this.decodeKey(data.key),
      value: this.decodeValue(data.value),
    }));
  }
  public entriesStream(opts?: IFilterOptions<I>): AsyncIterable<IKeyValue<I, T>> {
    const entriesStream = this.db.entriesStream(this.dbFilterOptions(opts));
    const decodeKey = this.decodeKey.bind(this);
    const decodeValue = this.decodeValue.bind(this);
    return (async function * () {
      for await (const entry of entriesStream) {
        yield {
          key: decodeKey(entry.key),
          value: decodeValue(entry.value),
        };
      }
    })();
  }

  public async firstKey(): Promise<I | null> {
    const keys = await this.keys({limit: 1});
    if (!keys.length) {
      return null;
    }
    return keys[0];
  }

  public async lastKey(): Promise<I | null> {
    const keys = await this.keys({limit: 1, reverse: true});
    if (!keys.length) {
      return null;
    }
    return keys[0];
  }

  public async firstValue(): Promise<T | null> {
    const values = await this.values({limit: 1});
    if (!values.length) {
      return null;
    }
    return values[0];
  }

  public async lastValue(): Promise<T | null> {
    const values = await this.values({limit: 1, reverse: true});
    if (!values.length) {
      return null;
    }
    return values[0];
  }

  public async firstEntry(): Promise<IKeyValue<I, T> | null> {
    const entries = await this.entries({limit: 1});
    if (!entries.length) {
      return null;
    }
    return entries[0];
  }

  public async lastEntry(): Promise<IKeyValue<I, T> | null> {
    const entries = await this.entries({limit: 1, reverse: true});
    if (!entries.length) {
      return null;
    }
    return entries[0];
  }

  /**
   * Transforms opts from I to Buffer
   */
  protected dbFilterOptions(opts?: IFilterOptions<I>): IFilterOptions<Buffer> {
    const _opts: IFilterOptions<Buffer> = {
      gte: _encodeKey(this.bucket, Buffer.alloc(0)),
      lt: _encodeKey(this.bucket + 1, Buffer.alloc(0)),
    };
    if (opts) {
      if (opts.lt) {
        _opts.lt = this.encodeKey(opts.lt);
      } else if (opts.lte) {
        delete _opts.lt;
        _opts.lte = this.encodeKey(opts.lte);
      }
      if (opts.gt) {
        delete _opts.gte;
        _opts.gt = this.encodeKey(opts.gt);
      } else if (opts.gte) {
        _opts.gte = this.encodeKey(opts.gte);
      }
      _opts.reverse = opts.reverse;
      _opts.limit = opts.limit;
    }
    return _opts;
  }
}
