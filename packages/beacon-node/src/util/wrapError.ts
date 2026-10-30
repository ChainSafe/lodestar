export type Result<T, E = Error> = {err: null; result: T} | {err: E};

/**
 * Wraps an operation to return either an error or result
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
export function wrapError<T>(promise: Promise<T>): Promise<Result<T>>;
export function wrapError<T, E>(fn: () => T | Promise<T>, mapError: (error: unknown) => E): Promise<Result<T, E>>;
export async function wrapError<T, E>(
  input: Promise<T> | (() => T | Promise<T>),
  mapError?: (error: unknown) => E
): Promise<Result<T, E | Error>> {
  try {
    return {err: null, result: await (typeof input === "function" ? input() : input)};
  } catch (err) {
    return {err: mapError ? mapError(err) : (err as Error)};
  }
}

/**
 * Some functions may want to return a result and some warning typed as Error
 */
export type WarnResult<T, E extends Error> = {result: T; warnings: E[] | null};
