const symErr = Symbol("err");

export type Err<T> = {[symErr]: true; error: T};

export type Result<T, E> = T | Err<E>;

// eslint-disable-next-line @typescript-eslint/naming-convention
export function Err<T>(error: T): Err<T> {
  return {[symErr]: true, error};
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result !== null && typeof result === "object" && (result as Err<E>)[symErr] === true;
}
