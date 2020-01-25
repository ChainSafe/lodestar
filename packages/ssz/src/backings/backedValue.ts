import {TreeBackedValue} from "./tree";

export enum BackingType {
  structural = "structural",
  tree = "tree",
  serialized = "serialized",
}

export type BackedValue<T extends object> = TreeBackedValue<T>;

export function isBackedValue<T extends object>(value: any): value is BackedValue<T> {
  if (value && value.backingType) {
    return true;
  } else {
    return false;
  }
}
