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
