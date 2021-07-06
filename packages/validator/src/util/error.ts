import {HttpError} from "@chainsafe/lodestar-api";
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

/**
 * Returns true if it's an network error with code 503 = Node is syncing
 * https://github.com/ethereum/eth2.0-APIs/blob/e68a954e1b6f6eb5421abf4532c171ce301c6b2e/types/http.yaml#L62
 */
export function isSyncing(e: Error): boolean {
  return !(e instanceof HttpError && e.status === 503);
}
