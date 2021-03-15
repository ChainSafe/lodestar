import {Vector} from "./Vector";

/**
 * A mutable reference to a Vector
 */
export class MutableVector<T> implements Iterable<T> {
  private constructor(public vector: Vector<T>) {}

  static empty<T>(): MutableVector<T> {
    return new MutableVector(Vector.empty());
  }

  static from<T>(values: Iterable<T>): MutableVector<T> {
    return new MutableVector(Vector.from(values));
  }

  get length(): number {
    return this.vector.length;
  }

  get(index: number): T | null {
    return this.vector.get(index);
  }

  set(index: number, value: T): void {
    this.vector = this.vector.set(index, value);
  }

  update(index: number, value: Partial<T>): T {
    const updated = {
      ...this.vector.get(index),
      ...value,
    } as T;
    this.vector = this.vector.set(index, updated);
    return updated;
  }

  push(value: T): void {
    this.vector = this.vector.append(value);
  }

  pop(): T | undefined {
    const last = this.vector.get(this.vector.length - 1);
    this.vector = this.vector.pop();
    return last ?? undefined;
  }

  *[Symbol.iterator](): Generator<T> {
    yield* this.vector[Symbol.iterator]();
  }

  forEach(func: (t: T, i: number) => void): void {
    this.vector.readOnlyForEach(func);
  }

  map<T2>(func: (t: T, i: number) => T2): T2[] {
    return this.vector.readOnlyMap(func);
  }

  clone(): MutableVector<T> {
    return new MutableVector(this.vector);
  }
}
