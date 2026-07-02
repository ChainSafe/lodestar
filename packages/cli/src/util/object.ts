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

/**
 * Flattens a nested object into a single-level object with dot-notation keys.
 *
 * Allows the rc config file to be written with either nested maps or dotted keys, e.g.
 * `{rest: {address: "0.0.0.0"}}` and `{"rest.address": "0.0.0.0"}` both flatten to
 * `{"rest.address": "0.0.0.0"}`, matching how CLI options are registered (`dot-notation`
 * is disabled in yargs). Arrays are preserved as values (not flattened by index) so
 * array options like `rest.namespace` or `bootnodes` keep working.
 *
 * If the same option is provided in both nested and dotted form, the value that appears
 * last in the file wins.
 */
export function flattenObject(obj: Record<string, unknown>, parentKey?: string): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const prefixedKey = parentKey ? `${parentKey}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(flattened, flattenObject(value as Record<string, unknown>, prefixedKey));
    } else {
      flattened[prefixedKey] = value;
    }
  }
  return flattened;
}
