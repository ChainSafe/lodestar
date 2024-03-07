/**
 * Expected error that shouldn't print a stack trace
 */
export class YargsError extends Error {}

export type Result<T> = {err: null; result: T} | {err: Error};
export async function wrapError<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    return {err: null, result: await promise};
  } catch (err) {
    return {err: err as Error};
  }
}
export function wrapFnError<T>(fn: () => T): Result<T> {
  try {
    return {err: null, result: fn()};
  } catch (err) {
    return {err: err as Error};
  }
}
