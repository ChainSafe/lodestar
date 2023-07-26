import {LinkedList} from "./array.js";

/**
 * An implementation of Set that support first() and last() method.
 */
export class OrderedSet<T> {
  private set: Set<T>;
  private array: LinkedList<T>;

  constructor() {
    this.set = new Set<T>();
    this.array = new LinkedList<T>();
  }

  add(item: T): void {
    if (!this.set.has(item)) {
      this.set.add(item);
      this.array.push(item);
    }
  }

  delete(item: T, searchFromHead: boolean): void {
    if (this.set.has(item)) {
      this.set.delete(item);
      if (searchFromHead) {
        this.array.deleteFirst(item);
      } else {
        this.array.deleteLast(item);
      }
    }
  }

  first(): T | null {
    if (this.array.length === 0) {
      return null;
    }
    return this.array.first();
  }

  last(): T | null {
    if (this.array.length === 0) {
      return null;
    }
    return this.array.last();
  }

  toArray(): T[] {
    return this.array.toArray();
  }

  values(): IterableIterator<T> {
    return this.array;
  }

  has(item: T): boolean {
    return this.set.has(item);
  }

  get size(): number {
    return this.set.size;
  }
}
