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

enum PromiseStatus {
  resolved,
  rejected,
  pending,
}

type PromiseState<T> =
  | {status: PromiseStatus.resolved; value: T}
  | {status: PromiseStatus.rejected; value: Error}
  | {status: PromiseStatus.pending; value: null};

function mapStatuesToResponses<T>(promisesStates: PromiseState<T>[]): (Error | T)[] {
  return promisesStates.map((pmStatus) => {
    switch (pmStatus.status) {
      case PromiseStatus.resolved:
        return pmStatus.value;
      case PromiseStatus.rejected:
        return pmStatus.value;
      case PromiseStatus.pending:
        return Error("pending");
    }
  });
}

export enum RaceEvent {
  precutoff = "precutoff-return",
  cutoff = "cutoff-reached",
  pretimeout = "pretimeout-return",
  timeout = "timeout-reached",
}

/**
 * Wait for promises to resolve till cutoff and then race them beyond the cutoff with an overall timeout
 * @return resolved values or rejections or still pending errors corresponding to input promises
 */
export async function racePromisesWithCutoff<T>(
  promises: Promise<T>[],
  cutoffMs: number,
  timeoutMs: number,
  eventCb: (event: RaceEvent) => void
): Promise<(Error | T)[]> {
  // start the cutoff and timeout timers
  let cutoffObserved = false;
  const cutoffPromise = new Promise((_resolve, reject) => setTimeout(reject, cutoffMs)).catch((e) => {
    cutoffObserved = true;
    throw e;
  });
  let timeoutObserved = false;
  const timeoutPromise = new Promise((_resolve, reject) => setTimeout(reject, timeoutMs)).catch((e) => {
    timeoutObserved = true;
    throw e;
  });

  // Track promises status and resolved values/rejected errors
  // Even if the promises reject with the following decoration promises will not throw
  const promisesStates = [] as PromiseState<T>[];
  promises.forEach((promise, index) => {
    promisesStates[index] = {status: PromiseStatus.pending, value: null};
    promise
      .then((value) => {
        promisesStates[index] = {status: PromiseStatus.resolved, value};
      })
      .catch((e: Error) => {
        promisesStates[index] = {status: PromiseStatus.rejected, value: e};
      });
  });

  // Wait till cutoff time unless all original promises resolve/reject early
  await Promise.allSettled(promises.map((promise) => Promise.race([promise, cutoffPromise])));
  if (cutoffObserved) {
    eventCb(RaceEvent.cutoff);
    // If any is resolved, then just simply return as we are post cutoff
    const anyResolved = promisesStates.reduce(
      (acc, pmState) => acc || pmState.status === PromiseStatus.resolved,
      false
    );
    if (anyResolved) {
      return mapStatuesToResponses(promisesStates);
    }
  } else {
    eventCb(RaceEvent.precutoff);
    return mapStatuesToResponses(promisesStates);
  }

  // Post deadline resolve with any of the promise or all rejected before timeout
  await Promise.any(promises.map((promise) => Promise.race([promise, timeoutPromise]))).catch((_e) => {
    if (timeoutObserved) {
      eventCb(RaceEvent.timeout);
    } else {
      eventCb(RaceEvent.pretimeout);
    }
  });
  return mapStatuesToResponses(promisesStates);
}
