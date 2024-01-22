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

/**
 * Promise that can be evaluated as normal promise but keep track of the status of promise and its response
 * It is useful when you want to process multiple promises and want know their status individually afterwards
 */
export class PromiseWithStatus<T> implements Promise<T> {
  private readonly _promise: Promise<T>;
  private _status: "pending" | "fulfilled" | "rejected" = "pending";
  private _value?: T;
  private _reason: unknown;
  readonly startedAt: number;
  private _finishedAt?: number;

  constructor(...args: ConstructorParameters<typeof Promise<T>> | [Promise<T>]) {
    this.startedAt = Date.now();

    this._promise =
      args.length === 1 && args[0] instanceof Promise
        ? args[0]
        : new Promise<T>(...(args as ConstructorParameters<typeof Promise<T>>));

    this._promise.then(
      (value) => {
        this._status = "fulfilled";
        this._value = value;
        this._finishedAt = Date.now();
        return value;
      },
      (reason) => {
        this._status = "rejected";
        this._reason = reason;
        this._finishedAt = Date.now();
      }
    );
  }

  [Symbol.toStringTag] = "Promise" as const;

  get durationMs(): number | undefined {
    return this._finishedAt != null ? this._finishedAt - this.startedAt : undefined;
  }

  get finishedAt(): number | undefined {
    return this._finishedAt;
  }

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
    onfulfilled: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected);
  }

  async catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined
  ): Promise<TResult | T> {
    return this._promise.catch(onrejected);
  }

  async finally(onfinally?: (() => void) | undefined): Promise<T> {
    return this._promise.finally(onfinally);
  }
}

/**
 * ArrayToTuple converts an `Array<T>` to `[T, ...T]`
 *
 * eg: `[1, 2, 3]` from type `number[]` to `[number, number, number]`
 */
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
    throw new Error("Race time must be greater than resolve time");
  }

  const mutedPromises = promises.map((p) => (p instanceof PromiseWithStatus ? p : new PromiseWithStatus(p)));
  const resolveTimeoutError = new TimeoutError(
    `Given promises can't be resolved within resolveTimeoutMs=${resolveTimeoutMs}`
  );
  const raceTimeoutError = new TimeoutError(
    `Not a any single promise be resolved in given raceTimeoutMs=${raceTimeoutMs}`
  );

  try {
    await Promise.race([
      Promise.allSettled(mutedPromises),
      sleep(resolveTimeoutMs, signal).then(() => {
        throw resolveTimeoutError;
      }),
    ]);
    return mutedPromises as ReturnPromiseWithTuple<T>;
  } catch (err) {
    if (err !== resolveTimeoutError) {
      throw err;
    }
  }

  try {
    await Promise.race([
      Promise.any(mutedPromises),
      sleep(raceTimeoutMs - resolveTimeoutMs, signal).then(() => {
        throw raceTimeoutError;
      }),
    ]);
  } catch (err) {
    if (err !== raceTimeoutError && !(err instanceof AggregateError)) {
      throw err;
    }
  }

  return mutedPromises as ReturnPromiseWithTuple<T>;
}
