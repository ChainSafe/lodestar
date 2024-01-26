import {ErrorAborted, TimeoutError} from "./errors.js";
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

export interface Abortable {
  abort: (reason: string) => void;
  readonly reason?: unknown;
}

export enum ExtendedPromiseStatus {
  Pending = "pending",
  Fulfilled = "fulfilled",
  Rejected = "rejected",
  Aborted = "aborted",
}

export const defaultAbortReason = "Aborted";

/**
 * Promise that can be evaluated as normal but with extended features
 *  - Keep track of the status of promise as enum value
 *  - Keep track of the promise response as attribute
 *  - Allow to abort a promise from internal or external source
 *
 * It is useful when you want to process multiple promises and want know their status individually afterwards
 */
export class ExtendedPromise<T> implements Promise<T>, Abortable {
  private _promise: Promise<T>;
  private _status: ExtendedPromiseStatus = ExtendedPromiseStatus.Pending;
  private _value?: T;
  private _reason: unknown; // For rejected or aborted case
  readonly startedAt: number;
  private _finishedAt?: number;
  private _abortController = new AbortController();

  constructor(
    executor: (resolve: (value: PromiseLike<T> | T) => void, reject: (reason: unknown) => void) => void,
    signal?: AbortSignal
  ) {
    this.startedAt = Date.now();
    this._promise = new Promise<T>((resolve, reject) => {
      const abortHandler = (): void => {
        if (this._reason instanceof ErrorAborted) {
          reject(this._reason);
        } else if (typeof this._reason === "string") {
          reject(new ErrorAborted(this._reason));
        } else if (this._reason instanceof Error) {
          reject(new ErrorAborted(this._reason.message));
        } else {
          reject(new ErrorAborted(defaultAbortReason));
        }
      };

      this._abortController.signal.addEventListener("abort", abortHandler);

      // An external signal can also be used to abort the promise
      signal?.addEventListener("abort", abortHandler);

      executor(resolve, reject);
    });

    this._promise.then(
      (value) => {
        this._status = ExtendedPromiseStatus.Fulfilled;
        this._value = value;
        this._finishedAt = Date.now();
        return value;
      },
      (reason) => {
        this._status = reason instanceof ErrorAborted ? ExtendedPromiseStatus.Aborted : ExtendedPromiseStatus.Rejected;
        this._reason = reason;
        this._finishedAt = Date.now();
      }
    );
  }

  [Symbol.toStringTag] = "Promise" as const;

  static from = <T>(promise: PromiseLike<T>, signal?: AbortSignal): ExtendedPromise<T> => {
    if (promise instanceof ExtendedPromise) {
      return promise as ExtendedPromise<T>;
    }

    return new ExtendedPromise<T>((resolve, reject) => {
      promise.then(resolve, reject);
    }, signal);
  };

  abort(reason: unknown): void {
    this._reason = typeof reason === "string" ? new ErrorAborted(reason) : reason;
    this._abortController.abort();
  }

  get durationMs(): number | undefined {
    return this._finishedAt != null ? this._finishedAt - this.startedAt : undefined;
  }

  get finishedAt(): number | undefined {
    return this._finishedAt;
  }

  get status(): ExtendedPromiseStatus {
    return this._status;
  }

  get value(): T {
    switch (this.status) {
      case ExtendedPromiseStatus.Fulfilled:
        return this._value as T;
      case ExtendedPromiseStatus.Rejected:
      case ExtendedPromiseStatus.Aborted:
        throw this._reason;
      case ExtendedPromiseStatus.Pending:
        throw new Error("Promise is still pending");
    }
  }

  get reason(): unknown {
    switch (this.status) {
      case ExtendedPromiseStatus.Fulfilled:
        throw new Error("Promise is fulfilled");
      case ExtendedPromiseStatus.Rejected:
      case ExtendedPromiseStatus.Aborted:
        return this._reason;
      case ExtendedPromiseStatus.Pending:
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
  [Index in keyof ArrayToTuple<Tuple>]: PromiseLike<Awaited<Tuple[Index]>>;
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

  const extendedPromises = promises.map((p) => (p instanceof ExtendedPromise ? p : ExtendedPromise.from(p, signal)));
  const resolveTimeoutError = new TimeoutError(
    `Given promises can't be resolved within resolveTimeoutMs=${resolveTimeoutMs}`
  );
  const raceTimeoutError = new TimeoutError(
    `Not a any single promise be resolved in given raceTimeoutMs=${raceTimeoutMs}`
  );

  try {
    await Promise.race([
      Promise.allSettled(extendedPromises),
      sleep(resolveTimeoutMs, signal).then(() => {
        throw resolveTimeoutError;
      }),
    ]);
    return extendedPromises as ReturnPromiseWithTuple<T>;
  } catch (err) {
    if (err !== resolveTimeoutError) {
      throw err;
    }
  }

  try {
    await Promise.race([
      Promise.any(extendedPromises),
      sleep(raceTimeoutMs - resolveTimeoutMs, signal).then(() => {
        throw raceTimeoutError;
      }),
    ]);
  } catch (err) {
    if (err !== raceTimeoutError && !(err instanceof AggregateError)) {
      throw err;
    }
  }

  return extendedPromises as ReturnPromiseWithTuple<T>;
}
