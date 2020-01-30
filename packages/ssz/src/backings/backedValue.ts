import {TreeBackedValue} from "./tree";
import {ByteArrayBackedValue} from "./byteArray";

export enum BackingType {
  tree = "tree",
  byteArray = "byteArray",
}

/**
 * A BackedValue is a value that is backed by a non-structural type
 *
 * It is implemented as an ES6 Proxy object that provides
 * - convenient access to the structural properties corresponding to its type
 * - additional methods for backing-specific implementations of ssz operations
 */
export type BackedValue<T extends object> = TreeBackedValue<T> | ByteArrayBackedValue<T>;

export function isBackedValue<T extends object>(value: unknown): value is BackedValue<T> {
  if (value && (value as BackedValue<T>).backingType) {
    return true;
  } else {
    return false;
  }
}
