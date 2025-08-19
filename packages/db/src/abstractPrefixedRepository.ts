import {Type} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH} from "./const.js";
import {KeyValue} from "./controller/index.js";
import {Db, DbReqOpts, FilterOptions} from "./controller/interface.js";
import {encodeKey} from "./util.js";

type Id = Uint8Array | string | number | bigint;

/**
 * Repository is a high level kv storage
 * This abstract repository is designed in a way to store items with different prefixed
 * Specially when those prefixed data is not available in the object to be stored
 *
 * By default, SSZ-encoded values,
 */
export abstract class PrefixedRepository<P, I extends Id, T> {
  private readonly dbReqOpts: DbReqOpts;

  protected constructor(
    protected config: ChainForkConfig,
    protected db: Db,
    protected bucket: number,
    protected type: Type<T>,
    private readonly bucketId: string
  ) {
    this.dbReqOpts = {bucketId: this.bucketId};
  }

  abstract encodeKeyRaw(prefix: P, id: I): Uint8Array;
  abstract decodeKeyRaw(raw: Uint8Array): {prefix: P; id: I};
  /**
   * Max key is inclusive
   * */
  abstract getMaxKeyRaw(prefix: P): Uint8Array;
  /**
   * Min key is inclusive
   * */
  abstract getMinKeyRaw(prefix: P): Uint8Array;

  protected encodeValue(value: T): Uint8Array {
    return this.type.serialize(value);
  }

  protected decodeValue(data: Uint8Array): T {
    return this.type.deserialize(data);
  }

  protected wrapKey(raw: Uint8Array): Uint8Array {
    return encodeKey(this.bucket, raw);
  }

  protected unwrapKey(key: Uint8Array): Uint8Array {
    return key.slice(BUCKET_LENGTH);
  }

  // The Id can be inferred from the value
  getId(value: T): I {
    return this.type.hashTreeRoot(value) as I;
  }

  async get(prefix: P, id: I): Promise<T | null> {
    const key = this.wrapKey(this.encodeKeyRaw(prefix, id));
    const v = await this.db.get(key, this.dbReqOpts);
    return v ? this.decodeValue(v) : null;
  }

  async getMany(prefix: P, ids: I[]): Promise<(T | undefined)[]> {
    const keys = [];
    for (const id of ids) {
      keys.push(this.wrapKey(this.encodeKeyRaw(prefix, id)));
    }
    const values = await this.db.getMany(keys, this.dbReqOpts);

    const result = [];
    for (const value of values) {
      result.push(value ? this.decodeValue(value) : undefined);
    }

    return result;
  }

  async getManyBinary(prefix: P, ids: I[]): Promise<(Uint8Array | undefined)[]> {
    const keys = [];
    for (const id of ids) {
      keys.push(this.wrapKey(this.encodeKeyRaw(prefix, id)));
    }
    return await this.db.getMany(keys, this.dbReqOpts);
  }

  async getBinary(prefix: P, id: I): Promise<Uint8Array | null> {
    const key = this.wrapKey(this.encodeKeyRaw(prefix, id));
    return await this.db.get(key, this.dbReqOpts);
  }

  async put(prefix: P, item: T): Promise<void> {
    const id = this.getId(item);
    const key = this.wrapKey(this.encodeKeyRaw(prefix, id));
    await this.db.put(key, this.encodeValue(item), this.dbReqOpts);
  }

  async putMany(prefix: P, items: T[]): Promise<void> {
    const batch: KeyValue<Uint8Array, Uint8Array>[] = [];
    for (const item of items) {
      const id = this.getId(item);
      const key = this.wrapKey(this.encodeKeyRaw(prefix, id));
      batch.push({key, value: this.encodeValue(item)});
    }
    await this.db.batchPut(batch, this.dbReqOpts);
  }

  async putBinary(prefix: P, id: I, bytes: Uint8Array): Promise<void> {
    const key = this.wrapKey(this.encodeKeyRaw(prefix, id));
    await this.db.put(key, bytes, this.dbReqOpts);
  }

  async putManyBinary(prefix: P, items: KeyValue<I, Uint8Array>[]): Promise<void> {
    const batch: KeyValue<Uint8Array, Uint8Array>[] = [];
    for (const {key, value} of items) {
      batch.push({key: this.wrapKey(this.encodeKeyRaw(prefix, key)), value: value});
    }
    await this.db.batchPut(batch, this.dbReqOpts);
  }

  async delete(prefix: P, id: I): Promise<void> {
    const key = this.wrapKey(this.encodeKeyRaw(prefix, id));
    await this.db.delete(key, this.dbReqOpts);
  }

  async deleteMany(prefix: P | P[]): Promise<void> {
    const keys: Uint8Array[][] = [];

    for (const p of Array.isArray(prefix) ? prefix : [prefix]) {
      const prefixedKeys = await this.db.keys({
        gte: this.wrapKey(this.getMinKeyRaw(p)),
        lte: this.wrapKey(this.getMaxKeyRaw(p)),
      });
      keys.push(prefixedKeys);
    }

    await this.db.batchDelete(keys.flat(), this.dbReqOpts);
  }

  async *valuesStream(prefix: P | P[]): AsyncIterable<T> {
    for (const p of Array.isArray(prefix) ? prefix : [prefix]) {
      for await (const vb of this.db.valuesStream({
        gte: this.wrapKey(this.getMinKeyRaw(p)),
        lte: this.wrapKey(this.getMaxKeyRaw(p)),
      })) {
        yield this.decodeValue(vb);
      }
    }
  }

  /**
   * Non iterative version of `valuesStream`.
   */
  async values(prefix: P | P[]): Promise<T[]> {
    const result: T[] = [];
    for await (const value of this.valuesStream(prefix)) {
      result.push(value);
    }
    return result;
  }

  async *valuesStreamBinary(prefix: P | P[]): AsyncIterable<{prefix: P; id: I; value: Uint8Array}> {
    for (const p of Array.isArray(prefix) ? prefix : [prefix]) {
      for await (const {key, value} of this.db.entriesStream({
        gte: this.wrapKey(this.getMinKeyRaw(p)),
        lte: this.wrapKey(this.getMaxKeyRaw(p)),
      })) {
        yield {
          ...this.decodeKeyRaw(key),
          value,
        };
      }
    }
  }

  /**
   * Non iterative version of `valuesStreamBinary`.
   */
  async valuesBinary(prefix: P | P[]): Promise<{prefix: P; id: I; value: Uint8Array}[]> {
    const result = [];
    for await (const value of this.valuesStreamBinary(prefix)) {
      result.push(value);
    }
    return result;
  }

  async *entriesStream(prefix: P | P[]): AsyncIterable<{prefix: P; id: I; value: T}> {
    for (const v of Array.isArray(prefix) ? prefix : [prefix]) {
      for await (const {key, value} of this.db.entriesStream({
        gte: this.wrapKey(this.getMinKeyRaw(v)),
        lte: this.wrapKey(this.getMaxKeyRaw(v)),
      })) {
        const {prefix, id} = this.decodeKeyRaw(this.unwrapKey(key));

        yield {
          prefix,
          id,
          value: this.decodeValue(value),
        };
      }
    }
  }

  async *entriesStreamBinary(prefix: P | P[]): AsyncIterable<{prefix: P; id: I; value: Uint8Array}> {
    for (const v of Array.isArray(prefix) ? prefix : [prefix]) {
      for await (const {key, value} of this.db.entriesStream({
        gte: this.wrapKey(this.getMinKeyRaw(v)),
        lt: this.wrapKey(this.getMaxKeyRaw(v)),
      })) {
        const {prefix, id} = this.decodeKeyRaw(this.unwrapKey(key));

        yield {
          prefix,
          id: id,
          value,
        };
      }
    }
  }

  async keys(opts?: FilterOptions<Uint8Array>): Promise<{prefix: P; id: I}[]> {
    const optsBuff: FilterOptions<Uint8Array> = {
      bucketId: this.bucketId,
    };

    // Set at least one min key
    if (opts?.lt !== undefined) {
      optsBuff.lt = this.wrapKey(opts.lt);
    } else if (opts?.lte !== undefined) {
      optsBuff.lte = this.wrapKey(opts.lte);
    }

    // Set at least on max key
    if (opts?.gt !== undefined) {
      optsBuff.gt = this.wrapKey(opts.gt);
    } else if (opts?.gte !== undefined) {
      optsBuff.gte = this.wrapKey(opts.gte);
    }

    if (opts?.reverse !== undefined) optsBuff.reverse = opts.reverse;
    if (opts?.limit !== undefined) optsBuff.limit = opts.limit;

    const data = await this.db.keys(optsBuff);
    return (data ?? []).map((data) => this.decodeKeyRaw(data));
  }
}
