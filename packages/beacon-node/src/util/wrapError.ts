export type Result<T, E extends Error = Error> = {err: null; result: T} | {err: E};

/**
 * Wraps a promise to return either an error or result
 * Useful for SyncChain code that must ensure in a sample code
 * ```ts
 * try {
 *   A()
 * } catch (e) {
 *   B()
 * }
 * ```
 * only EITHER fn A() and fn B() are called, but never both. In the snipped above
 * if A() throws, B() would be called.
 */
export async function wrapError<T, E extends Error>(promise: Promise<T>): Promise<Result<T, E>> {
  try {
    return {err: null, result: await promise};
  } catch (err) {
    return {err: err as E};
  }
}
