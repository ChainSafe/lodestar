import { TimeoutError } from "./errors.js";
import { sleep } from "./sleep.js";

export async function withTimeout<T>(
  asyncFn: (timeoutAndParentSignal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  const timeoutAbortController = new AbortController();

  // Create a merged signal manually
  if (signal) {
    signal.addEventListener('abort', () => timeoutAbortController.abort()); // Corrected line
  }

  async function timeoutPromise(signal: AbortSignal): Promise<never> {
    await sleep(timeoutMs, signal);
    throw new TimeoutError();
  }

  try {
    return await Promise.race([
      asyncFn(timeoutAbortController.signal),
      timeoutPromise(timeoutAbortController.signal)
    ]);
  } finally {
    timeoutAbortController.abort();
  }
}
