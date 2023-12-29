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

export class PromiseWithStatus<T> implements Promise<T> {
  private readonly _promise: Promise<T>;
  private _status: "pending" | "fulfilled" | "rejected" = "pending";
  private _value?: T;
  private _reason: unknown;

  constructor(...args: ConstructorParameters<typeof Promise<T>> | [Promise<T>]) {
    if (args.length === 1 && args[0] instanceof Promise) {
      this._promise = args[0];
    } else {
      this._promise = new Promise<T>(...(args as ConstructorParameters<typeof Promise<T>>));
    }

    this._promise.then(
      (value) => {
        this._status = "fulfilled";
        this._value = value;
        return value;
      },
      (reason) => {
        // We suppress error here to avoid unhandled promise rejection and handle the error with status
        this._status = "rejected";
        this._reason = reason;
      }
    );
  }

  [Symbol.toStringTag] = "Promise" as const;

  get status(): "pending" | "fulfilled" | "rejected" {
    return this._status;
  }

  get value(): T {
    switch (this.status) {
      case "fulfilled":
        return this._value as T;
      case "rejected":
        throw this._reason;
      case "pending":
        throw new Error("Promise is still pending");
    }
  }

  get reason(): unknown {
    switch (this.status) {
      case "fulfilled":
        throw new Error("Promise is fulfilled");
      case "rejected":
        return this._reason;
      case "pending":
        throw new Error("Promise is still pending");
    }
  }

  async then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected);
  }

  async catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined
  ): Promise<T | TResult> {
    return this._promise.catch(onrejected);
  }

  async finally(onfinally?: (() => void) | undefined): Promise<T> {
    return this._promise.finally(onfinally);
  }
}

type ReturnPromiseWithTuple<Tuple extends NonEmptyArray<unknown>> = {
  [Index in keyof ArrayToTuple<Tuple>]: PromiseWithStatus<Awaited<Tuple[Index]>>;
};

/**
 * Resolve all promises till `resolveTimeoutMs` if not then race them till `raceTimeoutMs`
 */
export async function resolveOrRacePromises<T extends NonEmptyArray<Promise<unknown> | PromiseWithStatus<unknown>>>(
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
    throw new Error("Race time mus tbe greater than resolve time");
  }

  const promisesWithStatuses = promises.map((p) => (p instanceof PromiseWithStatus ? p : new PromiseWithStatus(p)));
  const resolveTimeoutError = new TimeoutError(
    `Given promises can't be resolved within resolveTimeoutMs=${resolveTimeoutMs}`
  );
  const raceTimeoutError = new TimeoutError(
    `Not a any single promise be resolved in given raceTimeoutMs=${raceTimeoutMs}`
  );

  try {
    await Promise.race([
      Promise.allSettled(promisesWithStatuses),
      sleep(resolveTimeoutMs, signal).then(() => {
        throw resolveTimeoutError;
      }),
    ]);
    return promisesWithStatuses as ReturnPromiseWithTuple<T>;
  } catch (err) {
    if (err !== resolveTimeoutError) {
      throw err;
    }
  }

  try {
    await Promise.race([
      Promise.any(promisesWithStatuses),
      sleep(raceTimeoutMs - resolveTimeoutMs, signal).then(() => {
        throw raceTimeoutError;
      }),
    ]);
  } catch (err) {
    if (err !== raceTimeoutError && !(err instanceof AggregateError)) {
      throw err;
    }
  }

  return promisesWithStatuses as ReturnPromiseWithTuple<T>;
}
