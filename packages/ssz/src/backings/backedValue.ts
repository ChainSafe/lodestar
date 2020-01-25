import {TreeBackedValue} from "./tree";

export enum BackingType {
  structural = "structural",
  tree = "tree",
  serialized = "serialized",
}

/**
 * A BackedValue is a value that is backed by a non-structural type
 *
 * It is implemented as an ES6 Proxy object that provides
 * - convenient access to the structural properties corresponding to its type
 * - additional methods for backing-specific implementations of ssz operations
 */
export type BackedValue<T extends object> = TreeBackedValue<T>;

export function isBackedValue<T extends object>(value: any): value is BackedValue<T> {
  if (value && value.backingType) {
    return true;
  } else {
    return false;
  }
}
