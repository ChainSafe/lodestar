import {GossipQueue, IndexedGossipQueueOpts} from "./types.js";

type ItemList<T> = {
  items: T[];
  avgRecvTimestampMs: number;
};

function listScore<T>(list: ItemList<T>): number {
  return list.items.length / Math.max(1000, Date.now() - list.avgRecvTimestampMs);
}

/**
 * An implementation of GossipQueue that tries to run the batch with highest score first.
 * TODO: add unit tests
 * - index items by indexFn using a map
 * - compute avgRecvTimestampMs for each key every time we add new item
 * - on next, pick the key with the highest score (check the score function above)
 */
export class IndexedGossipQueueAvgTime<T extends {indexed?: string}> implements GossipQueue<T> {
  private _length = 0;
  private indexedItems: Map<string, ItemList<T>> = new Map();

  constructor(private readonly opts: IndexedGossipQueueOpts<T>) {}

  get length(): number {
    return this._length;
  }

  get keySize(): number {
    return this.indexedItems.size;
  }

  clear(): void {
    this.indexedItems = new Map();
    this._length = 0;
  }

  // not implemented for this gossip queue
  getDataAgeMs(): number[] {
    return [];
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
      list = {
        items: [],
        avgRecvTimestampMs: Date.now(),
      };
      this.indexedItems.set(key, list);
    } else {
      list.avgRecvTimestampMs = (list.avgRecvTimestampMs * list.items.length + Date.now()) / (list.items.length + 1);
      list.items.push(item);
    }
    this._length++;
    if (this._length <= this.opts.maxLength) {
      return 0;
    }

    // overload, need to drop more items
    const firstKey = this.indexedItems.keys().next().value as string;
    // there should be at least 1 key
    if (firstKey == null) {
      return 0;
    }
    const firstList = this.indexedItems.get(firstKey);
    // should not happen
    if (firstList == null) {
      return 0;
    }

    const deletedItem = firstList.items.shift();
    if (deletedItem != null) {
      this._length--;
      if (firstList.items.length === 0) {
        this.indexedItems.delete(firstKey);
      }
      return 1;
    } else {
      return 0;
    }
  }

  /**
   * Try to get list of items of the same key with highest score
   */
  next(): T[] | null {
    let maxScore = 0;
    let maxScoreKey: string | undefined;
    for (const [key, list] of this.indexedItems) {
      const score = listScore(list);
      if (score > maxScore) {
        maxScore = score;
        maxScoreKey = key;
      }
    }

    if (maxScoreKey == null) {
      return null;
    }
    const items = this.indexedItems.get(maxScoreKey)?.items;
    if (items == null) {
      // should not happen
      return null;
    }
    this.indexedItems.delete(maxScoreKey);
    this._length = Math.max(0, this._length - items.length);
    return items;
  }

  getAll(): T[] {
    const items: T[] = [];
    for (const list of this.indexedItems.values()) {
      items.push(...list.items);
    }
    return items;
  }
}
