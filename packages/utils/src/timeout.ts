import {AbortSignal, AbortController} from "@chainsafe/abort-controller";
import {anySignal} from "any-signal";
import {TimeoutError} from "./errors.js";
import {sleep} from "./sleep.js";

export async function withTimeout<T>(
  asyncFn: (timeoutAndParentSignal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  const timeoutAbortController = new AbortController();
  const timeoutAndParentSignal = anySignal([timeoutAbortController.signal, ...(signal ? [signal] : [])]) as AbortSignal;

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
