import {ErrorAborted} from "./errors.js";

/**
 * Abortable sleep function. Cleans everything on all cases preventing leaks
 * On abort throws ErrorAborted
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms < 0) {
    return;
  }

  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new ErrorAborted());

    let onDone: () => void = () => {};

    const timeout = setTimeout(() => {
      onDone();
      resolve();
    }, ms);
    const onAbort = (): void => {
      onDone();
      reject(new ErrorAborted());
    };
    if (signal) signal.addEventListener("abort", onAbort);

    onDone = () => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
  });
}

/**
 * Schedules in 1ms a Promise to be resolved during the `timers` phase.
 * Awaiting this Promise will force the whole event queue to be executed.
 *
 * Caution: as the execution of the event queue might lead to new enqueuing, this might take significant time.
 */
export function scheduleNextTimerPhase(): Promise<void> {
  // `setTimeout` delay is at least 1ms
  // Say https://nodejs.org/api/timers.html#settimeoutcallback-delay-args
  return sleep(1);
}

/**
 * Schedules in 1ms a callback for execution during the next `timers` phase.
 */
export function scheduleCallbackNextTimerPhase(callback: () => void): void {
  // `setTimeout` delay is at least 1ms
  // Say https://nodejs.org/api/timers.html#settimeoutcallback-delay-args
  setTimeout(callback, 1);
}
