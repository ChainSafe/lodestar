import { TimeoutError } from "./errors.js";
import { sleep } from "./sleep.js";

export async function withTimeout<T>(
  asyncFn: (timeoutAndParentSignal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  
  if (signal?.aborted) {
    throw signal.reason || new Error("Aborted");
  }

  const timeoutAbortController = new AbortController();
  const timeoutAndParentSignal = timeoutAbortController.signal;

  if (signal) {
    signal.addEventListener(
      "abort",
      (reason) => timeoutAbortController.abort(reason),
      { signal }
    );
  }

  async function timeoutPromise(): Promise<never> {
    await sleep(timeoutMs);
    timeoutAbortController.abort(new TimeoutError()); 
    throw new TimeoutError();
  }

  return await Promise.race([
    asyncFn(timeoutAndParentSignal),
    timeoutPromise(),
  ]);
}