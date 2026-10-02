import {RecursivePartial, isPlainObject} from "@lodestar/utils";

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
  // Guard non-plain input: an empty or scalar rc config file makes `readFile` return `undefined`
  // or a primitive, which would otherwise throw on `Object.entries`. `isPlainObject` also rejects
  // arrays and class instances (Date, Buffer, typed arrays); those are handled as leaf values below.
  if (!isPlainObject(obj)) {
    return {};
  }
  const flattened: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip prototype-polluting keys as defense-in-depth (config files can be semi-trusted).
    if (key === "__proto__") {
      continue;
    }
    const prefixedKey = parentKey ? `${parentKey}.${key}` : key;
    // Only recurse into plain objects; arrays and class instances (e.g. Date) are kept as leaf
    // values — recursing into them would silently drop or mis-flatten them.
    if (isPlainObject(value)) {
      Object.assign(flattened, flattenObject(value as Record<string, unknown>, prefixedKey));
    } else {
      flattened[prefixedKey] = value;
    }
  }
  return flattened;
}

/**
 * Rewrites `{prefix}.enabled` keys to the bare `{prefix}` flag.
 *
 * Some options are exposed as an on/off boolean flag (`--metrics`, `--rest`, `--builder`) whose
 * internal config shape nests the toggle under `.enabled` (e.g. `{metrics: {enabled, port}}`). This
 * lets an rc config file be written in the natural nested form:
 *
 * ```yaml
 * metrics:
 *   enabled: true
 *   port: 8008
 * ```
 *
 * which {@link flattenObject} turns into `{"metrics.enabled": true, "metrics.port": 8008}`. The CLI
 * registers the toggle as the bare `metrics` flag (there is no `metrics.enabled` option), so rewrite
 * `{prefix}.enabled` -> `{prefix}` to match a registered option. No CLI option is registered with an
 * `.enabled` suffix, so this is unambiguous. If the bare `{prefix}` key is already set (e.g. mixed
 * dotted and nested forms), the `.enabled` key is left untouched so the conflict surfaces as an
 * "unknown argument" error rather than being silently overridden.
 */
export function translateEnabledKeys(flattened: Record<string, unknown>): Record<string, unknown> {
  const suffix = ".enabled";
  const translated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flattened)) {
    const prefix = key.endsWith(suffix) ? key.slice(0, -suffix.length) : "";
    if (prefix && !(prefix in flattened)) {
      translated[prefix] = value;
    } else {
      translated[key] = value;
    }
  }
  return translated;
}
