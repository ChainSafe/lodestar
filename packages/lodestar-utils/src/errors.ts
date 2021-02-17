import {Json} from "@chainsafe/ssz";

/**
 * Generic Lodestar error with attached metadata
 */
export class LodestarError<T extends {code: string}> extends Error {
  type: T;
  constructor(type: T, message?: string) {
    super(message || type.code);
    this.type = type;
  }

  getMetadata(): {[key: string]: Json} {
    return this.type;
  }

  /**
   * Get the metadata and the stacktrace for the error.
   */
  toObject(): {[key: string]: Json} {
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
