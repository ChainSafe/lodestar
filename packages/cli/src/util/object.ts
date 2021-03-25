import {RecursivePartial} from "@chainsafe/lodestar-utils";

/**
 * Removes (mutates) all properties with a value === undefined, recursively
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function removeUndefinedRecursive<T extends {[key: string]: any}>(obj: T): RecursivePartial<T> {
  for (const key of Object.keys(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const value = obj[key];
    if (value && typeof value === "object") removeUndefinedRecursive(value);
    else if (value === undefined) delete obj[key];
  }
  return obj;
}
