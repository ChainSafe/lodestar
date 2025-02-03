import {LinkedList} from "../../../util/array.js";
import {OrderedSet} from "../../../util/set.js";
import {GossipQueue, IndexedGossipQueueMinSizeOpts} from "./types.js";

type QueueItem<T> = {
  listItems: LinkedList<T>;
  firstSeenMs: number;
};

/**
 * Enforce minimum wait time for each key. On a mainnet node, wait time for beacon_attestation
 * is more than 500ms, it's worth to take 1/10 of that to help batch more items.
 * This is only needed for key item < minChunkSize.
 */
const MINIMUM_WAIT_TIME_MS = 50;

/**
 * This implementation tries to get the most items with same key:
 *   - index items by indexFn using a map
 *   - store keys with at least minChunkSize
 *   - on next, pick the last key with minChunkSize, pop up to maxChunkSize items
 *   - on delete, pick the 1st key in the map and delete the 1st item in the list
 * Although it does not strictly follow LIFO, it tries to have that behavior:
 *   - On delete, get the first key and the first item of respective list
 *   - On next pick the last key with minChunksize
 *     - if there is no key with minChunkSize, pop the last item of the last key
 *
 * This is a special gossip queue for beacon_attestation topic
 */
export class IndexedGossipQueueMinSize<T extends {indexed?: string; queueAddedMs?: number}> implements GossipQueue<T> {
  private _length = 0;
  private indexedItems: Map<string, QueueItem<T>>;
  // keys with at least minChunkSize items
  // we want to process the last key with minChunkSize first, similar to LIFO
  private minChunkSizeKeys = new OrderedSet<string>();
  // wait time for the next() function to prevent having to search for items >=MINIMUM_WAIT_TIME_MS old repeatedly
  // this value is <= MINIMUM_WAIT_TIME_MS
  private nextWaitTimeMs: number | null = null;
  // the last time we checked for items >=MINIMUM_WAIT_TIME_MS old
  private lastWaitTimeCheckedMs = 0;
  constructor(private readonly opts: IndexedGossipQueueMinSizeOpts<T>) {
    const {minChunkSize, maxChunkSize} = opts;
    if (minChunkSize < 0 || maxChunkSize < 0 || minChunkSize > maxChunkSize) {
      throw Error(`Unexpected min chunk size ${minChunkSize}, max chunk size ${maxChunkSize}}`);
    }
    this.indexedItems = new Map<string, QueueItem<T>>();
  }

  get length(): number {
    return this._length;
  }

  get keySize(): number {
    return this.indexedItems.size;
  }

  clear(): void {
    this.indexedItems = new Map();
    this._length = 0;
    this.minChunkSizeKeys = new OrderedSet();
  }

  /**
   * Get age of each key in ms.
   */
  getDataAgeMs(): number[] {
    const now = Date.now();
    const result: number[] = [];
    for (const queueItem of this.indexedItems.values()) {
      result.push(now - queueItem.firstSeenMs);
    }
    return result;
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
    const now = Date.now();
    // here we mutate item, which is used for gossip validation later
    item.indexed = key;
    item.queueAddedMs = now;
    let queueItem = this.indexedItems.get(key);
    if (queueItem == null) {
      queueItem = {firstSeenMs: now, listItems: new LinkedList<T>()};
      this.indexedItems.set(key, queueItem);
    }
    queueItem.listItems.push(item);
    if (queueItem.listItems.length >= this.opts.minChunkSize) {
      this.minChunkSizeKeys.add(key);
    }
    this._length++;
    if (this._length <= this.opts.maxLength) {
      return 0;
    }

    // overload, need to drop more items
    const firstKey = this.indexedItems.keys().next().value as string | undefined;
    // there should be at least 1 key
    if (firstKey == null) {
      return 0;
    }
    const firstQueueItem = this.indexedItems.get(firstKey);
    // should not happen
    if (firstQueueItem == null) {
      return 0;
    }
    const deletedItem = firstQueueItem.listItems.shift();
    if (deletedItem != null) {
      this._length--;
      if (firstQueueItem.listItems.length === 0) {
        this.indexedItems.delete(firstKey);
      }
      if (firstQueueItem.listItems.length < this.opts.minChunkSize) {
        // it's faster to search for deleted item from the head in this case
        this.minChunkSizeKeys.delete(firstKey, true);
      }
      return 1;
    }
    return 0;
  }

  /**
   * Try to get items of last key with minChunkSize first.
   * If not, pick the last key with MINIMUM_WAIT_TIME_MS old
   */
  next(): T[] | null {
    let key: string | null = this.minChunkSizeKeys.last();
    if (key == null) {
      key = this.lastMinWaitKey();
    }

    if (key == null) {
      return null;
    }

    const queueItem = this.indexedItems.get(key);
    if (queueItem == null) {
      // should not happen
      return null;
    }

    const list = queueItem.listItems;
    const result: T[] = [];
    while (list.length > 0 && result.length < this.opts.maxChunkSize) {
      const t = list.pop();
      if (t != null) {
        result.push(t);
      }
    }

    if (list.length === 0) {
      this.indexedItems.delete(key);
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
      const array = this.indexedItems.get(key)?.listItems.toArray();
      if (array) {
        result.push(...array);
      }
    }

    return result;
  }

  /**
   * `indexedItems` is already sorted by key, so we can just iterate through it
   * Search for the last key with >= MINIMUM_WAIT_TIME_MS old
   * Do not search again if we already searched recently
   */
  private lastMinWaitKey(): string | null {
    const now = Date.now();
    // searched recently, skip
    if (this.nextWaitTimeMs != null && now - this.lastWaitTimeCheckedMs < this.nextWaitTimeMs) {
      return null;
    }

    this.lastWaitTimeCheckedMs = now;
    this.nextWaitTimeMs = null;
    let resultedKey: string | null = null;
    for (const [key, queueItem] of this.indexedItems.entries()) {
      if (now - queueItem.firstSeenMs >= MINIMUM_WAIT_TIME_MS) {
        // found, do not return to find the last key with >= MINIMUM_WAIT_TIME_MS old
        this.nextWaitTimeMs = null;
        resultedKey = key;
      } else {
        // if a key is not at least MINIMUM_WAIT_TIME_MS old, all remaining keys are not either
        break;
      }
    }

    if (resultedKey == null) {
      // all items are not old enough, set nextWaitTimeMs to avoid searching again
      const firstValue = this.indexedItems.values().next().value as QueueItem<T> | undefined;
      if (firstValue != null) {
        this.nextWaitTimeMs = Math.max(0, MINIMUM_WAIT_TIME_MS - (now - firstValue.firstSeenMs));
      }
    }

    return resultedKey;
  }
}
