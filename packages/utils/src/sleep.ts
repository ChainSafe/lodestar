import {AbortSignal} from "@chainsafe/abort-controller";
import {ErrorAborted} from "./errors.js";

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
