export type LodestarErrorMetaData = Record<string, string | number | null>;
export type LodestarErrorObject = LodestarErrorMetaData & {stack: string} & {className: string};
export type FromObjectFn = (object: LodestarErrorObject) => Error;

/**
 * Generic Lodestar error with attached metadata
 */
export class LodestarError<T extends {code: string}> extends Error {
  type: T;
  constructor(type: T, message?: string) {
    super(message || type.code);
    this.type = type;
  }

  getMetadata(): Record<string, string | number | null> {
    return this.type;
  }

  /**
   * Get the metadata and the stacktrace for the error.
   */
  toObject(): Record<string, string | number | null> {
    return {
      // Ignore message since it's just type.code
      ...this.getMetadata(),
      stack: this.stack || "",
    };
  }
}

/**
 * Generic Lodestar error with attached metadata that can be cloned.
 * Child classes should implement `fromObject` to deserialize the error.
 */
export class ClonableLodestarError<T extends {code: string}> extends LodestarError<T> {
  constructor(type: T, message?: string) {
    super(type, message);
  }

  /**
   * Add className to the error object so that it can be deserialized.
   */
  toObject(): LodestarErrorObject {
    return {
      // Ignore message since it's just type.code
      ...this.getMetadata(),
      stack: this.stack || "",
      className: this.constructor.name,
    };
  }
}

export function lodestarErrorObjectToMetaData(object: LodestarErrorObject): LodestarErrorMetaData {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {stack, className, ...metadata} = object;
  return metadata;
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
