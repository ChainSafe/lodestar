import {sleep} from "./sleep.js";

export type RetryOptions = {
  /**
   * The maximum amount of times to retry the operation. Default is 5
   */
  retries?: number;
  /**
   * An optional Function that is invoked after the provided callback throws
   * It expects a boolean to know if it should retry or not
   * Useful to make retrying conditional on the type of error thrown
   */
  shouldRetry?: (lastError: Error) => boolean;
  /**
   * Milliseconds to wait before retrying again
   */
  retryDelay?: number;
};

/**
 * Retry a given function on error.
 * @param fn Async callback to retry. Invoked with 1 parameter
 * A Number identifying the attempt. The absolute first attempt (before any retries) is 1
 * @param opts
 */
export async function retry<A>(fn: (attempt: number) => A | Promise<A>, opts?: RetryOptions): Promise<A> {
  const maxRetries = opts?.retries ?? 5;
  const shouldRetry = opts?.shouldRetry;

  let lastError: Error = Error("RetryError");
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastError = e as Error;
      if (shouldRetry && !shouldRetry(lastError)) {
        break;
      } else if (opts?.retryDelay !== undefined) {
        await sleep(opts?.retryDelay);
      }
    }
  }
  throw lastError;
}
