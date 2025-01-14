import {ErrorAborted} from "./errors.js";
import {sleep} from "./sleep.js";

export type RetryOptions = {
  /**
   * The maximum amount of times to retry the operation. Default is 5
   */
  retries?: number;
  /**
   * An optional Function that is invoked after the provided callback throws.
   * It expects a boolean to know if it should retry or not.
   * Useful to make retrying conditional on the type of error thrown.
   */
  shouldRetry?: (lastError: Error) => boolean;
  /**
   * An optional Function that is invoked right before a retry is performed.
   * It's passed the Error that triggered it and a number identifying the attempt.
   * Useful to track number of retries and errors in logs or metrics.
   */
  onRetry?: (lastError: Error, attempt: number) => unknown;
  /**
   * Milliseconds to wait before retrying again
   */
  retryDelay?: number;
  /**
   * Abort signal to stop retrying
   */
  signal?: AbortSignal;
};

/**
 * Retry a given function on error.
 * @param fn Async callback to retry. Invoked with 1 parameter
 * A Number identifying the attempt. The absolute first attempt (before any retries) is 1
 * @param opts
 */
export async function retry<A>(fn: (attempt: number) => A | Promise<A>, opts?: RetryOptions): Promise<A> {
  const maxRetries = opts?.retries ?? 5;
  // Number of retries + the initial attempt
  const maxAttempts = maxRetries + 1;
  const shouldRetry = opts?.shouldRetry;
  const onRetry = opts?.onRetry;

  let lastError: Error = Error("RetryError");
  for (let i = 1; i <= maxAttempts; i++) {
    // If not the first attempt
    if (i > 1) {
      if (opts?.signal?.aborted) {
        throw new ErrorAborted("retry");
      }
      // Invoke right before retrying
      onRetry?.(lastError, i);
    }

    try {
      return await fn(i);
    } catch (e) {
      lastError = e as Error;

      if (i === maxAttempts) {
        // Reached maximum number of attempts, there's no need to check if we should retry
        break;
      }

      if (shouldRetry && !shouldRetry(lastError)) {
        break;
      }

      if (opts?.retryDelay !== undefined) {
        await sleep(opts?.retryDelay, opts?.signal);
      }
    }
  }
  throw lastError;
}
