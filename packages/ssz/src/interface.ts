export interface ArrayLike<T> {
  readonly length: number;
  [n: number]: T;
  forEach(fn: (value: T, index: number) => void): void;
  //  reduce<U>(fn: (accum: U, value: T, index: number) => U, initial?: U): U;
}

export type Vector<T> = ArrayLike<T>;

export interface List<T> extends ArrayLike<T> {
  push(...values: T[]): number;
  pop(): T;
}

export type Container<T extends object> = T;

export type BitVector = ArrayLike<boolean>;

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
