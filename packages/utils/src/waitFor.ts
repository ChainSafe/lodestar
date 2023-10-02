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

export interface ElapsedTimeTracker {
  (): boolean;
  msSinceLastCall: number;
}

/**
 * Create a tracker which keeps track of the last time a function was called
 *
 * @param durationMs
 * @returns
 */
export function createElapsedTimeTracker({minElapsedTime}: {minElapsedTime: number}): ElapsedTimeTracker {
  // Initialized with undefined as the function has not been called yet
  let lastTimeCalled: number | undefined = undefined;

  function elapsedTimeTracker(): boolean {
    const now = Date.now();
    const msSinceLastCall = now - (lastTimeCalled ?? 0);
    lastTimeCalled = now;

    return msSinceLastCall > minElapsedTime;
  }

  return Object.assign(elapsedTimeTracker, {
    get msSinceLastCall() {
      return Date.now() - (lastTimeCalled ?? 0);
    },
  });
}
