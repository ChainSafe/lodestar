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

export enum ExtendedPromiseStatus {
  Pending = "pending",
  Fulfilled = "fulfilled",
  Rejected = "rejected",
  Aborted = "aborted",
  Timeout = "timeout",
}

export const defaultAbortReason = "Aborted";

export type ExtendedPromiseSuccessResult<T> = {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly status: ExtendedPromiseStatus.Fulfilled;
  readonly value: T;
};

export type ExtendedPromiseErrorResult =
  | {
      readonly startedAt: number;
      readonly finishedAt: number;
      readonly durationMs: number;
      readonly status: ExtendedPromiseStatus.Aborted | ExtendedPromiseStatus.Rejected;
      readonly reason: unknown;
    }
  | {
      readonly startedAt: number;
      readonly finishedAt: number;
      readonly durationMs: number;
      readonly status: ExtendedPromiseStatus.Timeout;
    };

export type ExtendedPromiseResult<T> = ExtendedPromiseSuccessResult<T> | ExtendedPromiseErrorResult;

/**
 * Promise that has extended features. To make it type-safe it is not extending Promise class.
 * It also inherits the pattern of `Promise.allSettled` and always resolve to an object with proper status.
 *
 *  - Keep track of the status of promise as enum value
 *  - Keep track of the promise response as attribute
 *  - Allow to abort a promise from internal or external source
 *
 * It is useful when you want to process multiple promises and want know their status individually afterwards
 */
export class ExtendedPromise<T, R = ExtendedPromiseResult<T>> extends Promise<R> {
  raiseError: boolean = false;

  private readonly _startedAt = Date.now();
  private _finishedAt?: number;
  private _status: ExtendedPromiseStatus = ExtendedPromiseStatus.Pending;
  private _abortController = new AbortController();

  constructor(
    executor: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
    opts?: {signal?: AbortSignal; timeoutMs?: number; raiseError?: boolean}
  ) {
    let _resolve: (val: R) => void;
    let _reject: (reason: unknown) => void;

    super((resolve: (val: R) => void, reject: (reason: unknown) => void) => {
      _resolve = resolve;
      _reject = reject;
    });

    this.raiseError = opts?.raiseError ?? false;
    let timeoutId: NodeJS.Timeout | undefined;

    const newResolve = (value: T | PromiseLike<T>): void => {
      this._finishedAt = Date.now();
      this._status = ExtendedPromiseStatus.Fulfilled;

      _resolve({
        startedAt: this._startedAt,
        finishedAt: this._finishedAt,
        durationMs: this._finishedAt - this._startedAt,
        status: this._status,
        value: value,
      } as R);
    };

    const newReject = (reason: unknown): void => {
      if (timeoutId) clearTimeout(timeoutId);
      this._finishedAt = Date.now();
      const exec = this.raiseError ? _reject : _resolve;

      if (reason instanceof ErrorAborted) {
        this._status = ExtendedPromiseStatus.Aborted;
        return exec({
          startedAt: this._startedAt,
          finishedAt: this._finishedAt,
          durationMs: this._finishedAt - this._startedAt,
          status: this._status,
          reason,
        } as R);
      }

      if (reason instanceof TimeoutError) {
        this._status = ExtendedPromiseStatus.Timeout;
        return exec({
          startedAt: this._startedAt,
          finishedAt: this._finishedAt,
          durationMs: this._finishedAt - this._startedAt,
          status: this._status,
        } as R);
      }

      this._status = ExtendedPromiseStatus.Rejected;
      exec({
        startedAt: this._startedAt,
        finishedAt: this._finishedAt,
        durationMs: this._finishedAt - this._startedAt,
        status: this._status,
        reason,
      } as R);
    };

    const abortHandler = (reason: unknown): void => {
      if (reason instanceof ErrorAborted || reason instanceof TimeoutError) {
        newReject(reason);
      } else if (typeof reason === "string") {
        newReject(new ErrorAborted(reason));
      } else if (reason instanceof Error) {
        newReject(new ErrorAborted(reason.message));
      } else {
        newReject(new ErrorAborted(defaultAbortReason));
      }
    };
    this._abortController.signal.addEventListener("abort", () => abortHandler(this._abortController.signal.reason));
    opts?.signal?.addEventListener("abort", () => abortHandler(opts?.signal?.reason));

    if (opts?.timeoutMs != null) {
      timeoutId = setTimeout(
        () => {
          newReject(new TimeoutError());
        },
        opts?.timeoutMs
      );
    }

    executor(newResolve, newReject);
  }

  abort(reason: unknown): void {
    this._abortController.abort(reason);
  }

  /**
   * Useful to set timeout status instead of abort from using an external timer
   */
  timeout(reason: string): void {
    this._abortController.abort(new TimeoutError(reason));
  }

  get status(): ExtendedPromiseStatus {
    return this._status;
  }

  static from<T>(
    promise: PromiseLike<T>,
    opts?: {signal?: AbortSignal; timeoutMs?: number; raiseError?: boolean}
  ): ExtendedPromise<T> {
    return new ExtendedPromise((resolve, reject) => {
      promise.then(resolve, reject);
    }, opts);
  }

  static async any(promises: ExtendedPromise<unknown>[]): Promise<ExtendedPromiseResult<unknown>> {
    const res = await Promise.any(promises);
    if (res.status === ExtendedPromiseStatus.Fulfilled) {
      return res;
    }
    return ExtendedPromise.any(promises.filter((p) => p.status === ExtendedPromiseStatus.Pending));
  }
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

  const extendedPromises = promises.map((p) => {
    if (p instanceof ExtendedPromise) {
      p.raiseError = false;
      return p;
    } else {
      return ExtendedPromise.from(p, {signal, raiseError: false});
    }
  });

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

    return Promise.all(extendedPromises) as ReturnPromiseWithTuple<T>;
  } catch (err) {
    if (err !== resolveTimeoutError) {
      throw err;
    }
  }

  try {
    await Promise.race([
      ExtendedPromise.any(extendedPromises.filter((p) => p.status === ExtendedPromiseStatus.Pending)),
      sleep(raceTimeoutMs - resolveTimeoutMs, signal).then(() => {
        throw raceTimeoutError;
      }),
    ]);

    for (const p of extendedPromises) {
      if (p.status === ExtendedPromiseStatus.Pending) {
        p.abort("Got one result, aborting others");
      }
    }
  } catch (err) {
    if (err !== raceTimeoutError && !(err instanceof AggregateError)) {
      throw err;
    }

    if (err === raceTimeoutError) {
      for (const p of extendedPromises) {
        if (p.status === ExtendedPromiseStatus.Pending) {
          p.timeout(`Aborting on timeout ${raceTimeoutMs}ms`);
        }
      }
    }
  }

  return Promise.all(extendedPromises) as ReturnPromiseWithTuple<T>;
}
