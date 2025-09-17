import {RecursivePartial} from "@lodestar/utils";

/**
 * Removes (mutates) all properties with a value === undefined, recursively
 */

// biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
export function removeUndefinedRecursive<T extends {[key: string]: any}>(obj: T): RecursivePartial<T> {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === "object") removeUndefinedRecursive(value);
    else if (value === undefined) delete obj[key];
  }
  return obj as RecursivePartial<T>;
}
