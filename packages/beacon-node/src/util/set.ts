/**
 * An implementation of Set that support first() and last() method.
 */
export class OrderedSet<T> {
  private set: Set<T>;
  private array: T[];

  constructor() {
    this.set = new Set<T>();
    this.array = [];
  }

  add(item: T): void {
    if (!this.set.has(item)) {
      this.set.add(item);
      this.array.push(item);
    }
  }

  delete(item: T): void {
    if (this.set.has(item)) {
      this.set.delete(item);
      this.array.splice(this.array.indexOf(item), 1);
    }
  }

  first(): T | null {
    if (this.array.length === 0) {
      return null;
    }
    return this.array[0];
  }

  last(): T | null {
    if (this.array.length === 0) {
      return null;
    }
    return this.array[this.array.length - 1];
  }

  toArray(): T[] {
    return this.array.slice(); // Return a shallow copy of the array
  }

  values(): IterableIterator<T> {
    return this.array.values();
  }

  has(item: T): boolean {
    return this.set.has(item);
  }

  size(): number {
    return this.set.size;
  }
}
