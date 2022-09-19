/**
 * Spread merge two objects dropping undefined values of the latter object to merge.
 *
 * ```
 * { ...({port: 9596}), ...({port: undefined})} }
 * ```
 * returns `{port: 9596}`, which can break downstream as port is typed as required.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type
export function mergeOpts<A extends {[key: string]: any}, B extends {[key: string]: any}>(a: A, b: B) {
  return {...a, ...removeUndefined(b)};
}

/**
 * Removes (mutates) all properties with a value === undefined
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function removeUndefined<T extends {[key: string]: any}>(obj: T): T {
  for (const key of Object.keys(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const value = obj[key];
    if (value === undefined) delete obj[key];
  }
  return obj;
}
