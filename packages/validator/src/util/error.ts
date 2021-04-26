import {ErrorAborted} from "@chainsafe/lodestar-utils";

/**
 * Extend an existing error by appending a string to its `e.message`
 */
export function extendError(e: Error, prependMessage: string): Error {
  e.message = `${prependMessage} - ${e.message}`;
  return e;
}

/**
 * Returns true if arg `e` is not an instance of `ErrorAborted`
 */
export function notAborted(e: Error): boolean {
  return !(e instanceof ErrorAborted);
}
