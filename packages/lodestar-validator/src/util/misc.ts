import {AbortSignal} from "abort-controller";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function abortableTimeout(
  signal: AbortSignal | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (this: AbortSignal, ev: Event) => void
): void {
  signal?.addEventListener("abort", callback, {once: true});
}
