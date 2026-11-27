import {vi} from "vitest";

export function immediates(): (() => void)[] {
  const queued: (() => void)[] = [];
  const hold = (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
    queued.push(() => callback(...args));
  };
  vi.spyOn(globalThis, "setImmediate").mockImplementation(hold as unknown as typeof setImmediate);
  return queued;
}
