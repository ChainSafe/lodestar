import {sleep} from "@lodestar/utils";

/**
 * Wrap a promise with a timeout
 */
export function wrapTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  opts?: {timeoutMsg?: string; signal?: AbortSignal}
): Promise<T> {
  return Promise.race([
    p,
    sleep(timeoutMs, opts?.signal).then(() => {
      throw new Error(opts?.timeoutMsg ?? `Promise timeout after ${timeoutMs}ms.`);
    }),
  ]) as Promise<T>;
}
