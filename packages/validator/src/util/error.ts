/**
 * Extend an existing error by appending a string to its `e.message`
 */
export function extendError(e: Error, prependMessage: string): Error {
  e.message = `${prependMessage} - ${e.message}`;
  return e;
}
