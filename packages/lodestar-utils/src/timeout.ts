import {AbortSignal, AbortController} from "abort-controller";
import {anySignal} from "any-signal";
import {TimeoutError} from "./errors";
import {sleep} from "./sleep";

export async function withTimeout<T>(asyncFn: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timeoutAbortController = new AbortController();
  const bothSignal = anySignal([timeoutAbortController.signal, ...(signal ? [signal] : [])]);

  async function timeoutPromise(): Promise<never> {
    await sleep(timeoutMs, bothSignal as AbortSignal);
    throw new TimeoutError();
  }

  try {
    return await Promise.race([asyncFn(), timeoutPromise()]);
  } finally {
    timeoutAbortController.abort();
  }
}
