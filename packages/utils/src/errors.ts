export type LodestarErrorMetaData = Record<string, string | number | null>;
export type LodestarErrorObject = {
  message: string;
  stack: string;
  className: string;
  type: LodestarErrorMetaData;
};
export type FromObjectFn = (object: LodestarErrorObject) => Error;

/**
 * Generic Lodestar error with attached metadata
 */
export class LodestarError<T extends {code: string}> extends Error {
  type: T;
  constructor(type: T, message?: string, stack?: string) {
    super(message || type.code);
    this.type = type;
    if (stack) this.stack = stack;
  }

  getMetadata(): LodestarErrorMetaData {
    return this.type;
  }

  /**
   * Get the metadata and the stacktrace for the error.
   */
  toObject(): LodestarErrorObject {
    return {
      type: this.getMetadata(),
      message: this.message ?? "",
      stack: this.stack ?? "",
      className: this.constructor.name,
    };
  }

  static fromObject(obj: LodestarErrorObject): LodestarError<{code: string}> {
    return new LodestarError(obj.type as {code: string}, obj.message, obj.stack);
  }
}

/**
 * Throw this error when an upstream abort signal aborts
 */
export class ErrorAborted extends Error {
  constructor(message?: string) {
    super(`Aborted ${message || ""}`);
  }
}

/**
 * Throw this error when wrapped timeout expires
 */
export class TimeoutError extends Error {
  constructor(message?: string) {
    super(`Timeout ${message || ""}`);
  }
}

/**
 * Returns true if arg `e` is an instance of `ErrorAborted`
 */
export function isErrorAborted(e: unknown): e is ErrorAborted {
  return e instanceof ErrorAborted;
}

/**
 * Extend an existing error by appending a string to its `e.message`
 */
export function extendError(e: Error, appendMessage: string): Error {
  e.message = `${e.message} - ${appendMessage}`;
  return e;
}
