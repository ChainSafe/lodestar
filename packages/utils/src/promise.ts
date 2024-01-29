import {TimeoutError} from "./errors.js";
import {sleep} from "./sleep.js";
import {ArrayToTuple, NonEmptyArray} from "./types.js";

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
      if (t === undefined) fn();
    }
    return undefined;
  };

  t = await Promise.race([p, logFn()]);
  // should not happen since p doesn not resolve to undefined
  if (t === undefined) {
    throw new Error("Unexpected error: Timeout");
  }
  return t;
}

export type PromiseResult<T> = {
  promise: Promise<T>;
} & (
  | {
      status: "pending";
    }
  | {
      status: "fulfilled";
      value: T;
      durationMs: number;
    }
  | {
      status: "rejected";
      reason: unknown;
      durationMs: number;
    }
);
export type PromiseFulfilledResult<T> = PromiseResult<T> & {status: "fulfilled"};
export type PromiseRejectedResult<T> = PromiseResult<T> & {status: "rejected"};

/**
 * Wrap a promise to an object to track the status and value of the promise
 */
export function wrapPromise<T>(promise: PromiseLike<T>): PromiseResult<T> {
  const startedAt = Date.now();

  const result: PromiseResult<T> = {
    promise,
    status: "pending",
  } as PromiseResult<T>;

  promise.then(
    (value) => {
      result.status = "fulfilled";
      (result as PromiseFulfilledResult<T>).value = value;
      (result as PromiseFulfilledResult<T>).durationMs = Date.now() - startedAt;
    },
    (reason: unknown) => {
      result.status = "rejected";
      (result as PromiseRejectedResult<T>).reason = reason;
      (result as PromiseRejectedResult<T>).durationMs = Date.now() - startedAt;
    }
  );

  return result;
}

/**
 * ArrayToTuple converts an `Array<T>` to `[T, ...T]`
 *
 * eg: `[1, 2, 3]` from type `number[]` to `[number, number, number]`
 */
type ReturnPromiseWithTuple<Tuple extends NonEmptyArray<PromiseLike<unknown>>> = {
  [Index in keyof ArrayToTuple<Tuple>]: Awaited<Tuple[Index]>;
};

/**
 * Resolve all promises till `resolveTimeoutMs` if not then race them till `raceTimeoutMs`
 */
export async function resolveOrRacePromises<T extends NonEmptyArray<PromiseLike<unknown>>>(
  promises: T,
  {
    resolveTimeoutMs,
    raceTimeoutMs,
    signal,
  }: {
    resolveTimeoutMs: number;
    raceTimeoutMs: number;
    signal?: AbortSignal;
  }
): Promise<ReturnPromiseWithTuple<T>> | never {
  if (raceTimeoutMs <= resolveTimeoutMs) {
    throw new Error("Race time must be greater than resolve time");
  }
  const resolveTimeoutError = new TimeoutError(
    `Given promises can't be resolved within resolveTimeoutMs=${resolveTimeoutMs}`
  );
  const raceTimeoutError = new TimeoutError(
    `Not a any single promise be resolved in given raceTimeoutMs=${raceTimeoutMs}`
  );

  const promiseResults = promises.map((p) => wrapPromise(p)) as ReturnPromiseWithTuple<T>;

  try {
    await Promise.race([
      Promise.allSettled(promises),
      sleep(resolveTimeoutMs, signal).then(() => {
        throw resolveTimeoutError;
      }),
    ]);

    return promiseResults;
  } catch (err) {
    if (err !== resolveTimeoutError) {
      throw err;
    }
  }

  try {
    await Promise.race([
      Promise.any(
        promiseResults
          .filter((r) => (r as PromiseResult<unknown>).status === "pending")
          .map((r) => (r as PromiseResult<unknown>).promise)
      ),
      sleep(raceTimeoutMs - resolveTimeoutMs, signal).then(() => {
        throw raceTimeoutError;
      }),
    ]);

    return promiseResults;
  } catch (err) {
    if (err !== raceTimeoutError && !(err instanceof AggregateError)) {
      throw err;
    }
  }

  return promiseResults;
}
