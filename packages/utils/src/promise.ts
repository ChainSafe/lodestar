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

export async function racePromisesWithCutoff<T>(inputs: Promise<T>[], cutoffMs: number): Promise<(Error | T)[]> {
  return new Promise((resolve, reject) => {
    try {
      const promisesStatus = [] as PromiseState<T>[];
      let deadLineFullFilled = false;

      const mapStatues = (): (Error | T)[] =>
        promisesStatus.map((pmStatus) => {
          switch (pmStatus.status) {
            case PromiseStatus.resolved:
              return pmStatus.value;
            case PromiseStatus.rejected:
              return pmStatus.value;
            case PromiseStatus.pending:
              return Error("Deadline finished");
          }
        });

      const checkAndResolve = (): void => {
        if (deadLineFullFilled) {
          let resolvedAny = false;
          let rejectedAll = true;

          for (let index = 0; index < inputs.length; index++) {
            resolvedAny = resolvedAny || promisesStatus[index].status === PromiseStatus.resolved;
            rejectedAll = rejectedAll && promisesStatus[index].status === PromiseStatus.rejected;
          }

          if (resolvedAny || rejectedAll) {
            resolve(mapStatues());
          }
        } else {
          // Return if all are resolved or rejected return, no point waiting any further
          let anyPending = false;
          for (let index = 0; index < inputs.length; index++) {
            anyPending = anyPending || promisesStatus[index].status === PromiseStatus.pending;
          }
          if (!anyPending) {
            resolve(mapStatues());
          }
        }
      };

      Array.from({length: inputs.length}, (_v, index) => {
        promisesStatus[index] = {status: PromiseStatus.pending, value: null};

        inputs[index]
          .then((value) => {
            promisesStatus[index] = {status: PromiseStatus.resolved, value};
            if (deadLineFullFilled) {
              resolve(mapStatues());
            } else {
              checkAndResolve();
            }
          })
          .catch((e: Error) => {
            promisesStatus[index] = {status: PromiseStatus.rejected, value: e};
            checkAndResolve();
          })
          .catch((e) => {
            reject(e);
          });
        if (deadLineFullFilled) {
          resolve(mapStatues());
        }
      });

      // IF there is no pending promise then just resolve
      checkAndResolve();
      // Wait for cutoff
      sleep(cutoffMs)
        .then(() => {
          // If any promise resolved return will all the resolves
          deadLineFullFilled = true;
          checkAndResolve();
        })
        .catch((e) => {
          reject(e);
        });
    } catch (e) {
      reject(e);
    }
  });
}

// Some testcases vectors
// p1 = Promise.resolve("3")
// p2 = new Promise((resolve, reject) => {setTimeout(() => {resolve("foo");}, 500);});
// p3 = new Promise((resolve, reject) => {setTimeout(() => {resolve("foo");}, 1500);});
// p4 = new Promise((resolve, reject) => {setTimeout(() => {reject(Error("foo"));}, 5000);});
// p5 = Promise.reject(Error("rejectme"))
//
// utl.racePromisesWithCutoff([p1,p2,p3,p4,p5],1000).then(values=>{console.log({values})})
// utl.racePromisesWithCutoff([p2,p3,p4,p5],1000).then(values=>{console.log({values})})
// utl.racePromisesWithCutoff([p3,p4,p5],1000).then(values=>{console.log({values})})
// utl.racePromisesWithCutoff([p4,p5],1000).then(values=>{console.log({values})})
