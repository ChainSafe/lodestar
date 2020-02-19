/* eslint-disable @typescript-eslint/interface-name-prefix */

/**
 * These interfaces are consistent across all backings.
 * As long as these interfaces are respected, the backing can be abstracted entirely.
 */

export interface ArrayLike<T> {
  readonly length: number;
  [n: number]: T;
  [Symbol.iterator](): Iterator<T>;
  find(fn: (value: T, index: number, array: this) => boolean): T | undefined;
  findIndex(fn: (value: T, index: number, array: this) => boolean): number;
  forEach(fn: (value: T, index: number, array: this) => void): void;
}

export type Vector<T> = ArrayLike<T>;

export interface List<T> extends ArrayLike<T> {
  push(...values: T[]): number;
  pop(): T;
}

export type Container<T extends object> = T;

export type ByteVector = Vector<number>;

export type BitVector = Vector<boolean>;

export type BitList = List<boolean>;

export interface ObjectLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [fieldName: string]: any;
}

/**
 * The Json interface is used for json-serializable input
 */
export type Json =
    | string
    | number
    | boolean
    | null
    | { [property: string]: Json }
    | Json[];
