import {AbortOptions} from "@libp2p/interface";
import {BaseDatastore} from "datastore-core";
import {Batch, Key, KeyQuery, Pair, Query} from "interface-datastore";
import {DeleteFailedError, GetFailedError, NotFoundError, OpenFailedError, PutFailedError} from "interface-store";
import {LevelDb, LevelDbOperation} from "@chainsafe/lodestar-z/leveldb";

export class NativeDatastore extends BaseDatastore {
  private database?: Promise<LevelDb>;
  private closing?: Promise<void>;

  constructor(private readonly path: string) {
    super();
  }

  async open(): Promise<void> {
    if (this.closing) await this.closing;
    this.database ??= LevelDb.open(this.path).catch((error: unknown) => {
      this.database = undefined;
      throw new OpenFailedError(String(error));
    });
    await this.database;
  }

  close(): Promise<void> {
    this.closing ??= this.closeDatabase().finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }

  private async closeDatabase(): Promise<void> {
    if (this.database) {
      await (await this.database).close();
      this.database = undefined;
    }
  }

  async put(key: Key, value: Uint8Array, options?: AbortOptions): Promise<Key> {
    options?.signal?.throwIfAborted();
    try {
      await (await this.getDatabase()).put(keyBytes(key), value);
      return key;
    } catch (error) {
      throw new PutFailedError(String(error));
    }
  }

  async get(key: Key, options?: AbortOptions): Promise<Uint8Array> {
    options?.signal?.throwIfAborted();
    let value: Uint8Array | null;
    try {
      value = await (await this.getDatabase()).get(keyBytes(key));
    } catch (error) {
      throw new GetFailedError(String(error));
    }
    if (value === null) throw new NotFoundError();
    return value;
  }

  async has(key: Key, options?: AbortOptions): Promise<boolean> {
    options?.signal?.throwIfAborted();
    return (await (await this.getDatabase()).get(keyBytes(key))) !== null;
  }

  async delete(key: Key, options?: AbortOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    try {
      await (await this.getDatabase()).del(keyBytes(key));
    } catch (error) {
      throw new DeleteFailedError(String(error));
    }
  }

  batch(): Batch {
    const operations: LevelDbOperation[] = [];
    return {
      put: (key, value) => operations.push({type: "put", key: keyBytes(key), value}),
      delete: (key) => operations.push({type: "del", key: keyBytes(key)}),
      commit: async (options) => {
        options?.signal?.throwIfAborted();
        await (await this.getDatabase()).batch(operations);
      },
    };
  }

  async *_all(query: Query, options?: AbortOptions): AsyncGenerator<Pair> {
    options?.signal?.throwIfAborted();
    const db = await this.getDatabase();
    for await (const {key, value} of db.iterator(prefixRange(query.prefix))) {
      options?.signal?.throwIfAborted();
      yield {key: new Key(key, false), value};
    }
  }

  async *_allKeys(query: KeyQuery, options?: AbortOptions): AsyncGenerator<Key> {
    options?.signal?.throwIfAborted();
    const db = await this.getDatabase();
    for await (const key of db.keys(prefixRange(query.prefix))) {
      options?.signal?.throwIfAborted();
      yield new Key(key, false);
    }
  }

  private getDatabase(): Promise<LevelDb> {
    if (!this.database || this.closing) throw new OpenFailedError("Datastore is not open");
    return this.database;
  }
}

function keyBytes(key: Key): Uint8Array {
  return Buffer.from(key.toString(), "utf8");
}

function prefixRange(prefix?: string): {gte?: Uint8Array; lt?: Uint8Array} {
  if (!prefix) return {};
  const gte = Buffer.from(prefix, "utf8");
  const lt = Buffer.from(gte);
  // A UTF-8 prefix never ends in 0xff, so incrementing its last byte forms the exclusive bound.
  lt[lt.length - 1]++;
  return {gte, lt};
}
