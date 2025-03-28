import { TimeoutError } from "./errors.js";
import { sleep } from "./sleep.js";

export async function withTimeout<T>(
  asyncFn: (timeoutAndParentSignal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  const timeoutAbortController = new AbortController();
  const timeoutAndParentSignal = timeoutAbortController.signal;

  let abortListener: (() => void) | undefined;

  if (signal) {
    abortListener = () => timeoutAbortController.abort();
    signal.addEventListener("abort", abortListener);
  }

  async function timeoutPromise(signal: AbortSignal): Promise<never> {
    await sleep(timeoutMs, signal);
    throw new TimeoutError();
  }

  try {
    return await Promise.race([
      asyncFn(timeoutAndParentSignal),
      timeoutPromise(timeoutAndParentSignal),
    ]);
  } finally {
    timeoutAbortController.abort();
    if (signal && abortListener) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}
