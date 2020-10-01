import {Json} from "@chainsafe/ssz";

/**
 * Generic Lodestar error with attached metadata
 */
export class LodestarError<T extends {code: string}> extends Error {
  type: T;
  constructor(type: T) {
    super(type.code);
    this.type = type;
  }

  getMetadata(): {[key: string]: Json} {
    return this.type;
  }

  toObj(): {[key: string]: Json} {
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
