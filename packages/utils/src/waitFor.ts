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

interface ElapsedTimeTrackerAttributes {
  msSinceLastError?: number;
  msSinceLastCall?: number;
  now: number;
}

interface ElapsedTimeTrackerOptions {
  minElapsedTime: number;
  onError?: (data: ElapsedTimeTrackerAttributes) => void;
}

type ElapsedTimeTrackerCaller = (data: ElapsedTimeTrackerAttributes) => void;
export type ElapsedTimeTracker = (fn: ElapsedTimeTrackerCaller) => void;

/**
 * Create a tracker which keeps track of the last time a function was called
 *
 * @param durationMs
 * @returns
 */
export function waitForElapsedTime({minElapsedTime, onError}: ElapsedTimeTrackerOptions): ElapsedTimeTracker {
  // Initialized with undefined as the function has not been called yet
  let lastTimeCalled: number | undefined = undefined;
  let lastTimeError: number | undefined = undefined;

  return function elapsedTimeTracker(fn: ElapsedTimeTrackerCaller): void {
    const now = Date.now();

    const msSinceLastCall = lastTimeCalled === undefined ? undefined : now - lastTimeCalled;
    const msSinceLastError = lastTimeError === undefined ? undefined : now - lastTimeError;

    if (msSinceLastCall !== undefined && msSinceLastCall < minElapsedTime) {
      if (onError) onError({now, msSinceLastError, msSinceLastCall});
      lastTimeError = now;
      return;
    }

    fn({now, msSinceLastCall, msSinceLastError});
    lastTimeCalled = now;
  };
}
