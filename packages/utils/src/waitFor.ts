import {ErrorAborted, TimeoutError} from "./errors.js";

export type WaitForOpts = {
  /** Time in milliseconds between checking condition */
  interval?: number;
  /** Time in milliseconds to wait before throwing TimeoutError */
  timeout?: number;
  /** Abort signal to stop waiting for condition by throwing ErrorAborted */
  signal?: AbortSignal;
};

/**
 * Wait for a condition to be true
 */
export function waitFor(condition: () => boolean, opts: WaitForOpts = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const {interval = 10, timeout = Infinity, signal} = opts;

    if (signal?.aborted) {
      return reject(new ErrorAborted());
    }

    if (condition()) {
      return resolve();
    }

    let onDone: () => void = () => {};

    const timeoutId = setTimeout(() => {
      onDone();
      reject(new TimeoutError());
    }, timeout);

    const intervalId = setInterval(() => {
      if (condition()) {
        onDone();
        resolve();
      }
    }, interval);

    const onAbort = (): void => {
      onDone();
      reject(new ErrorAborted());
    };
    if (signal) signal.addEventListener("abort", onAbort);

    onDone = () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
  });
}
