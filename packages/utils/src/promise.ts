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
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
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
        }
      };

      Array.from({length: inputs.length}, (_v, index) => {
        promisesStatus[index] = {status: PromiseStatus.pending, value: null};

        inputs[index]
          .then((value) => {
            promisesStatus[index] = {status: PromiseStatus.resolved, value};
            if (deadLineFullFilled) {
              resolve(mapStatues());
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

      await sleep(cutoffMs);
      // If any promise resolved return will all the resolves
      deadLineFullFilled = true;
      checkAndResolve();
    } catch (e) {
      reject(e);
    }
  });
}
