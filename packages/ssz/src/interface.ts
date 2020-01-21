// Typesript has an ArrayLike, but its readonly
export interface ArrayLike<T> {
  readonly length: number;
  [n: number]: T;
}

export type Vector<T> = ArrayLike<T>;

export interface List<T> extends ArrayLike<T> {
  push(value: T): number;
  pop(): T;
}

export type Container<T extends object> = T;

export type BitVector = ArrayLike<boolean>;

export type BitList = List<boolean>;

export interface ObjectLike {
  [fieldName: string]: any;
}
