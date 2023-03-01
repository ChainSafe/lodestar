const symErr = Symbol("err");

export type Err<T> = {[symErr]: true; error: T};

export type Result<T, E> = T | Err<E>;

// eslint-disable-next-line @typescript-eslint/naming-convention
export function Err<T>(error: T): Err<T> {
  return {[symErr]: true, error};
}

/**
 * Typeguard for Err<T>. Allows the pattern
 * ```ts
 * function getNumSquare(): Result<number, Error> {
 *   const value = getNum();
 *   if (isErr(value)) {
 *     return value; // return as error
 *   }
 *   return value ** 2;
 * }
 * function getNum(): Result<number, Error>
 * ```
 * Since the non-error is not wrapped, it uses a symbol to prevent collisions
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result !== null && typeof result === "object" && (result as Err<E>)[symErr] === true;
}

/**
 * Given an array of results, run a function only on an array of ok results.
 * Returns a new array of results with same length as `results` where the ok
 * value may be Err or T2.
 */
export function mapOkResults<T1, T2, E>(
  results: Result<T1, E>[],
  fn: (items: T1[]) => Result<T2, E>[]
): Result<T2, E>[] {
  const oks: T1[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    if (!isErr(result)) {
      oks.push(result);
    }
  }

  const outOksResults = fn(oks);
  if (outOksResults.length !== oks.length) {
    throw Error("mapOkResults fn must return same length");
  }

  const outResults: Result<T2, E>[] = [];

  for (let i = 0, j = 0; i < results.length; i++) {
    const result = results[i];

    if (isErr(result)) {
      outResults.push(result);
    } else {
      outResults.push(outOksResults[j]);
      j++;
    }
  }

  return outResults;
}

/**
 * See {@link mapOkResults} but `fn` is async
 */
export async function mapOkResultsAsync<T1, T2, E>(
  results: Result<T1, E>[],
  fn: (items: T1[]) => Promise<Result<T2, E>[]>
): Promise<Result<T2, E>[]> {
  const oks: T1[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    if (!isErr(result)) {
      oks.push(result);
    }
  }

  const outOksResults = await fn(oks);
  if (outOksResults.length !== oks.length) {
    throw Error("mapOkResults fn must return same length");
  }

  const outResults: Result<T2, E>[] = [];

  for (let i = 0, j = 0; i < results.length; i++) {
    const result = results[i];

    if (isErr(result)) {
      outResults.push(result);
    } else {
      outResults.push(outOksResults[j]);
      j++;
    }
  }

  return outResults;
}
