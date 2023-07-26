import {LinkedList} from "../../../util/array.js";
import {OrderedSet} from "../../../util/set.js";
import {OrderedMap} from "../../../util/map.js";
import {GossipQueue, IndexedGossipQueueOpts} from "./types.js";

/**
 * This implementation tries to get the most items with same key:
 *   - index items by indexFn using a map
 *   - store keys with at least minChunkSize
 *   - on next, pick the the last key with minChunkSize, pop up to maxChunkSize items
 *   - on delete, pick the 1st key in the map and delete the 1st item in the list
 * Although it does not strictly follow LIFO, it tries to have that behavior:
 *   - On delete, get the first key and the first item of respective list
 *   - On next pick the last key with minChunksize
 *     - if there is no key with minChunkSize, pop the last item of the last key
 *
 * This is a special gossip queue for beacon_attestation topic
 */
export class IndexedGossipQueue<T extends {indexed?: string}> implements GossipQueue<T> {
  private _length = 0;
  private indexedItems: OrderedMap<string, LinkedList<T>>;
  // keys with at least minChunkSize items
  // we want to process the last key with minChunkSize first, similar to LIFO
  private minChunkSizeKeys = new OrderedSet<string>();
  constructor(private readonly opts: IndexedGossipQueueOpts<T>) {
    const {minChunkSize, maxChunkSize} = opts;
    if (minChunkSize < 0 || maxChunkSize < 0 || minChunkSize > maxChunkSize) {
      throw Error(`Unexpected min chunk size ${minChunkSize}, max chunk size ${maxChunkSize}}`);
    }
    this.indexedItems = new OrderedMap<string, LinkedList<T>>();
  }

  get length(): number {
    return this._length;
  }

  get keySize(): number {
    return this.indexedItems.size();
  }

  clear(): void {
    this.indexedItems = new OrderedMap();
    this._length = 0;
    this.minChunkSizeKeys = new OrderedSet();
  }

  /**
   * Add item to gossip queue. If queue is full, drop first item of first key.
   * Return number of items dropped
   */
  add(item: T): number {
    const key = this.opts.indexFn(item);
    if (key == null) {
      // this comes from getAttDataBase64FromAttestationSerialized() return type
      // should not happen
      return 0;
    }
    item.indexed = key;
    let list = this.indexedItems.get(key);
    if (list == null) {
      list = new LinkedList<T>();
      this.indexedItems.set(key, list);
    }
    list.push(item);
    if (list.length >= this.opts.minChunkSize) {
      this.minChunkSizeKeys.add(key);
    }
    this._length++;
    if (this._length <= this.opts.maxLength) {
      return 0;
    }

    // overload, need to drop more items
    const firstKey = this.indexedItems.firstKey();
    // there should be at least 1 key
    if (firstKey == null) {
      return 0;
    }
    const firstList = this.indexedItems.get(firstKey);
    // should not happen
    if (firstList == null) {
      return 0;
    }
    const deletedItem = firstList.shift();
    if (deletedItem != null) {
      this._length--;
      if (firstList.length === 0) {
        // it's faster to search for deleted item from the head in this case
        this.indexedItems.delete(firstKey, true);
      }
      if (firstList.length < this.opts.minChunkSize) {
        // it's faster to search for deleted item from the head in this case
        this.minChunkSizeKeys.delete(firstKey, true);
      }
      return 1;
    } else {
      return 0;
    }
  }

  /**
   * Try to get items of last key with minChunkSize first.
   * If not, pick the last key
   */
  next(): T[] | null {
    let key: string | null = this.minChunkSizeKeys.last();
    if (key == null) {
      key = this.indexedItems.lastKey();
    }

    if (key == null) {
      return null;
    }

    const list = this.indexedItems.get(key);
    if (list == null) {
      // should not happen
      return null;
    }

    const result: T[] = [];
    while (list.length > 0 && result.length < this.opts.maxChunkSize) {
      const t = list.pop();
      if (t != null) {
        result.push(t);
      }
    }

    if (list.length === 0) {
      // it's faster to search for deleted item from the tail in this case
      this.indexedItems.delete(key, false);
    }
    if (list.length < this.opts.minChunkSize) {
      // it's faster to search for deleted item from the tail in this case
      this.minChunkSizeKeys.delete(key, false);
    }
    this._length = Math.max(0, this._length - result.length);

    return result;
  }

  getAll(): T[] {
    const result: T[] = [];
    for (const key of this.indexedItems.keys()) {
      const array = this.indexedItems.get(key)?.toArray();
      if (array) {
        result.push(...array);
      }
    }

    return result;
  }
}
