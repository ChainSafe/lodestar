import {sleep} from "./sleep.js";

/**
 * While promise t is not finished, call function `fn` per `interval`
 */
export async function callFnWhenAwait<T>(
  p: Promise<NonNullable<T>>,
  fn: () => void,
  interval: number
): Promise<NonNullable<T>> {
  let t: NonNullable<T> | undefined = undefined;
  const logFn = async (): Promise<undefined> => {
    while (t === undefined) {
      await sleep(interval);
      fn();
    }
    return undefined;
  };

  t = await Promise.race([p, logFn()]);
  // should not happen
  if (t === undefined) {
    throw new Error("Unexpected error: Timeout");
  }
  return t;
}
