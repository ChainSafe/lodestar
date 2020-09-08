import {AbortSignal} from "abort-controller";
import {ErrorAborted} from "./errors";

/**
 * Abortable sleep function. Cleans everything on all cases preventing leaks
 * On abort throws ErrorAborted
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new ErrorAborted());

    // eslint-disable-next-line @typescript-eslint/no-empty-function
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
 * Abortable async setInterval that runs its callback once at max between `ms` at minimum
 * @param fn Callback. Should never throw
 */
export async function setIntervalAbortableAsync(
  fn: () => Promise<void>,
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  let lastRunMs = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    lastRunMs = Date.now();

    try {
      await fn();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        "UnhandledPromiseRejectionWarning in setIntervalAbortableAsync\n" +
          "callbacks should never throw, wrap them in try catch block\n" +
          e.stack
      );
    }

    const sleepTime = Math.max(ms + lastRunMs - Date.now(), 0);
    await sleep(sleepTime, signal);
  }
}
