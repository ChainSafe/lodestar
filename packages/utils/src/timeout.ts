import {anySignal} from "any-signal";
import {ErrorAborted, TimeoutError} from "./errors.js";
import {sleep} from "./sleep.js";

export async function withTimeout<T>(
  asyncFn: (timeoutAndParentSignal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    throw new ErrorAborted();
  }

  const timeoutAbortController = new AbortController();
  const timeoutAndParentSignal = anySignal([timeoutAbortController.signal, ...(signal ? [signal] : [])]);

  async function timeoutPromise(signal: AbortSignal): Promise<never> {
    await sleep(timeoutMs, signal);
    throw new TimeoutError();
  }

  try {
    return await Promise.race([asyncFn(timeoutAndParentSignal), timeoutPromise(timeoutAndParentSignal)]);
  } finally {
    timeoutAbortController.abort();
  }
}
