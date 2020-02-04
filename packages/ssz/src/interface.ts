export interface ArrayLike<T> {
  readonly length: number;
  [n: number]: T;
  [Symbol.iterator](): Iterator<T>;
  find(fn: (value: T, index: number, array: this) => boolean): T | undefined;
  findIndex(fn: (value: T, index: number, array: this) => boolean): number;
  forEach(fn: (value: T, index: number, array: this) => void): void;
  //map<U>(fn: (value: T, index: number, array: this) => U): U[];
  //map(fn: (value: number, index: number, array: this) => number): Uint8Array;
  //  reduce<U>(fn: (accum: U, value: T, index: number) => U, initial?: U): U;
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
  [fieldName: string]: any;
}

export type Json =
    | string
    | number
    | boolean
    | null
    | { [property: string]: Json }
    | Json[];
