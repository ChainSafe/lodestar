import {AbortSignal} from "abort-controller";

/**
 * Abortable sleep function. Cleans everything on all cases preventing leaks
 * On abort returns without throwing an error
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  let onDone: () => void = () => {};
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", resolve);
    onDone = () => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", resolve);
    };
  });
  onDone();
}
