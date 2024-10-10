import {OrderedSet} from "./set.js";

/**
 * An implementation of Map that support getting first/last key and value.
 */
export class OrderedMap<K, V> {
  private _set: OrderedSet<K>;
  private map: Map<K, V>;

  constructor() {
    this._set = new OrderedSet<K>();
    this.map = new Map<K, V>();
  }

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): this {
    this._set.add(key);
    this.map.set(key, value);
    return this;
  }

  delete(key: K, searchFromHead: boolean): boolean {
    if (this.map.has(key)) {
      this._set.delete(key, searchFromHead);
      return this.map.delete(key);
    }
    return false;
  }

  keys(): IterableIterator<K> {
    return this._set.values();
  }

  lastKey(): K | null {
    return this._set.last();
  }

  firstKey(): K | null {
    return this._set.first();
  }

  values(): IterableIterator<V> {
    const _self = this;
    return (function* generateValues() {
      for (const key of _self.keys()) {
        yield _self.get(key) as V;
      }
    })();
  }

  lastValue(): V | null {
    const lastKey = this._set.last();
    if (lastKey === null) {
      return null;
    }
    return this.get(lastKey) as V;
  }

  firstValue(): V | null {
    const firstKey = this._set.first();
    if (firstKey === null) {
      return null;
    }
    return this.get(firstKey) as V;
  }

  size(): number {
    return this._set.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }
}
