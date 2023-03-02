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

function mapStatues<T>(promisesStates: PromiseState<T>[]): (Error | T)[] {
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

  // Track promises status and resolved values
  // even if the promises reject, but with the following decoration promises will now
  // not throw
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
  } else {
    eventCb(RaceEvent.precutoff);
    return mapStatues(promisesStates);
  }
  // Post deadline resolve with any of the promise or all rejected before timeout
  await Promise.any(promises.map((promise) => Promise.race([promise, timeoutPromise]))).catch((_e) => {
    if (timeoutObserved) {
      eventCb(RaceEvent.timeout);
    } else {
      eventCb(RaceEvent.pretimeout);
    }
  });
  return mapStatues(promisesStates);
}

// Some testcases vectors
// p1 = Promise.resolve("3")
// p2 = new Promise((resolve, reject) => {setTimeout(() => {resolve("foo");}, 50000);});
// p3 = new Promise((resolve, reject) => {setTimeout(() => {resolve("foo");}, 15000);});
// p4 = new Promise((resolve, reject) => {setTimeout(() => {reject(Error("foo"));}, 50000);});
// p5 = Promise.reject(Error("rejectme"))

// utl.racePromisesWithCutoff([p2,p3,p4,p5],1000,9000,(event)=>{console.log({event})}).then(values=>{console.log({values})})
// utl.racePromisesWithCutoff([p2,p3,p4,p5],1000).then(values=>{console.log({values})})
// utl.racePromisesWithCutoff([p3,p4,p5],1000).then(values=>{console.log({values})})
// utl.racePromisesWithCutoff([p4,p5],1000).then(values=>{console.log({values})})
