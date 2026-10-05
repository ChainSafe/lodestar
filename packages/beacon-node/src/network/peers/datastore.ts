import {AbortOptions} from "@libp2p/interface";
import {BaseDatastore} from "datastore-core";
import {Datastore, Key, KeyQuery, Pair, Query} from "interface-datastore";
import {NotFoundError} from "interface-store";
import {NativeDatastore} from "./nativeDatastore.js";

type MemoryItem = {
  lastAccessedMs: number;
  data: Uint8Array;
};

type PeerDatastore = Datastore & {open(): Promise<void>; close(): Promise<void>};

/**
 * Before libp2p 0.35, peerstore stays in memory and periodically write to db after n dirty items
 * This has a memory issue because all peer data stays in memory and loaded at startup time
 * This is written for libp2p >=0.35, we maintain the same mechanism but with bounded data structure
 * This datastore includes a memory datastore and fallback to db datastore
 * Use an in-memory datastore with last accessed time and maxMemoryItems, on start it's empty (lazy load)
 * - get: Search in-memory datastore first, if not found search from db.
 *     - If found from db, add back to the in-memory datastore
 *     - Update lastAccessedMs
 * - put: move oldest items from memory to db if there are more than maxMemoryItems items in memory
 *     -  update memory datastore, only update db datastore if there are at least threshold dirty items
 *     -  Update lastAccessedMs
 */
export class Eth2PeerDataStore extends BaseDatastore {
  private dbDatastore: PeerDatastore;
  private memoryDatastore: Map<string, MemoryItem>;
  /** Same to PersistentPeerStore of the old libp2p implementation */
  private dirtyItems = new Set<string>();
  /** If there are more dirty items than threshold, commit data to db */
  private threshold: number;
  /** If there are more memory items than this, prune oldest ones from memory and move to db */
  private maxMemoryItems: number;

  constructor(
    dbDatastore: PeerDatastore | string,
    {threshold = 5, maxMemoryItems = 50}: {threshold?: number | undefined; maxMemoryItems?: number | undefined} = {}
  ) {
    super();

    if (threshold <= 0 || maxMemoryItems <= 0) {
      throw Error(`Invalid threshold ${threshold} or maxMemoryItems ${maxMemoryItems}`);
    }
    if (threshold > maxMemoryItems) {
      throw Error(`Threshold ${threshold} should be at most maxMemoryItems ${maxMemoryItems}`);
    }

    this.dbDatastore = typeof dbDatastore === "string" ? new NativeDatastore(dbDatastore) : dbDatastore;
    this.memoryDatastore = new Map();
    this.threshold = threshold;
    this.maxMemoryItems = maxMemoryItems;
  }

  async open(): Promise<void> {
    return this.dbDatastore.open();
  }

  async close(): Promise<void> {
    if (this.dirtyItems.size > 0) await this._commitData();
    await this.dbDatastore.close();
    this.memoryDatastore.clear();
  }

  async put(key: Key, val: Uint8Array, _options?: AbortOptions): Promise<Key> {
    return this._put(key, val, false);
  }

  /**
   * Same interface to put with "fromDb" option, if this item is updated back from db
   * Move oldest items from memory data store to db if it's over this.maxMemoryItems
   */
  async _put(key: Key, val: Uint8Array, fromDb = false): Promise<Key> {
    while (this.memoryDatastore.size >= this.maxMemoryItems) {
      // it's likely this is called only 1 time
      await this.pruneMemoryDatastore();
    }

    const keyStr = key.toString();
    const memoryItem = this.memoryDatastore.get(keyStr);
    if (memoryItem) {
      // update existing
      memoryItem.lastAccessedMs = Date.now();
      memoryItem.data = val;
    } else {
      // new
      this.memoryDatastore.set(keyStr, {data: val, lastAccessedMs: Date.now()});
    }

    if (!fromDb) await this._addDirtyItem(keyStr);
    return key;
  }

  /**
   * Check memory datastore - update lastAccessedMs, then db datastore
   * If found in db datastore then update back the memory datastore
   * This throws error if not found
   */
  async get(key: Key, options?: AbortOptions): Promise<Uint8Array> {
    const keyStr = key.toString();
    const memoryItem = this.memoryDatastore.get(keyStr);
    if (memoryItem) {
      memoryItem.lastAccessedMs = Date.now();
      return memoryItem.data;
    }

    // this throws error if not found
    const dbValue = await this.dbDatastore.get(key, options);
    // don't call this.memoryDatastore.set directly
    // we want to get through prune() logic with fromDb as true
    await this._put(key, dbValue, true);
    return dbValue;
  }

  async has(key: Key, options?: AbortOptions): Promise<boolean> {
    try {
      await this.get(key, options);
    } catch (err) {
      if (err instanceof NotFoundError) return false;
      throw err;
    }
    return true;
  }

  async delete(key: Key, options?: AbortOptions): Promise<void> {
    this.memoryDatastore.delete(key.toString());
    await this.dbDatastore.delete(key, options);
  }

  async *_all(q: Query, options?: AbortOptions): AsyncGenerator<Pair> {
    for (const [key, value] of this.memoryDatastore.entries()) {
      yield {
        key: new Key(key),
        value: value.data,
      };
    }
    for await (const pair of this.dbDatastore.query({prefix: q.prefix}, options)) {
      if (!this.memoryDatastore.has(pair.key.toString())) yield pair;
    }
  }

  async *_allKeys(q: KeyQuery, options?: AbortOptions): AsyncGenerator<Key> {
    for (const key of this.memoryDatastore.keys()) {
      yield new Key(key);
    }
    for await (const key of this.dbDatastore.queryKeys({prefix: q.prefix}, options)) {
      if (!this.memoryDatastore.has(key.toString())) yield key;
    }
  }

  private async _addDirtyItem(keyStr: string): Promise<void> {
    this.dirtyItems.add(keyStr);
    if (this.dirtyItems.size >= this.threshold) {
      try {
        await this._commitData();
      } catch (_e) {}
    }
  }

  private async _commitData(): Promise<void> {
    const batch = this.dbDatastore.batch();
    for (const keyStr of this.dirtyItems) {
      const memoryItem = this.memoryDatastore.get(keyStr);
      if (memoryItem) {
        batch.put(new Key(keyStr), memoryItem.data);
      }
    }
    await batch.commit();
    this.dirtyItems.clear();
  }

  /**
   * Prune from memory and move to db
   */
  private async pruneMemoryDatastore(): Promise<void> {
    let oldestAccessedMs = Date.now() + 1000;
    let oldestKey: string | undefined = undefined;
    let oldestValue: Uint8Array | undefined = undefined;

    for (const [key, value] of this.memoryDatastore) {
      if (value.lastAccessedMs < oldestAccessedMs) {
        oldestAccessedMs = value.lastAccessedMs;
        oldestKey = key;
        oldestValue = value.data;
      }
    }

    if (oldestKey && oldestValue) {
      await this.dbDatastore.put(new Key(oldestKey), oldestValue);
      this.memoryDatastore.delete(oldestKey);
    }
  }
}
