import {REQUEST_ERROR_CLASS_NAME, RESPONSE_ERROR_CLASS_NAME, RequestError, ResponseError} from "@lodestar/reqresp";
import {FromObjectFn, LodestarError, LodestarErrorObject} from "@lodestar/utils";
import {ClonableLodestarError} from "@lodestar/utils";

/**
 * Error that can be passed across thread boundaries
 */
export type ThreadBoundaryError = {error: null; object: LodestarErrorObject} | {error: Error; object: null};

/**
 * Structured clone does not work with Error objects.
 * For ClonableLodestarError, we want to specify the LodestarErrorObject with className so that we can deserialize later.
 */
export function toThreadBoundaryError(error: Error): ThreadBoundaryError {
  if (error instanceof ClonableLodestarError) {
    return {error: null, object: error.toObject()};
  }

  // note that non-clonable errors will be deserialized as a generic Error object
  return {error, object: null};
}

/**
 * Only RequestError and ResponseError pass through thread boundaries.
 * If we pass more errors in the future through thread boundaries, we need to add them here.
 */
const fromObjectFnRegistry = new Map<string, FromObjectFn>([
  [RESPONSE_ERROR_CLASS_NAME, ResponseError.fromObject],
  [REQUEST_ERROR_CLASS_NAME, RequestError.fromObject],
]);

/**
 * If error is ClonableLodestarError, deserialize it from the LodestarErrorObject.
 * Else use the generic Error object.
 */
export function fromThreadBoundaryError(error: ThreadBoundaryError): Error {
  if (error.error) {
    // this is always a generic Error object
    return error.error;
  }

  let clonedError: Error;
  const fromObjectFn = fromObjectFnRegistry.get(error.object.className);
  if (fromObjectFn) {
    clonedError = fromObjectFn(error.object);
  } else {
    // should not happen as a ClonableLodestarError class should implement "fromObject" method and register it
    // try our best to clone the error with the same stack trace
    clonedError = new LodestarError({code: "UNKNOWN_ERROR_CLASS"}, `Unknown error class ${error.object.className}`);
  }

  clonedError.stack = error.object.stack;
  return clonedError;
}
