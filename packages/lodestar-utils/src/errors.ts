import {Json} from "@chainsafe/ssz";
import {toJson} from "./json";

/**
 * Generic Lodestar error with attached metadata
 */
export class LodestarError<T extends {code: string}> extends Error {
  data: T;
  constructor(data: T) {
    super(data.code);
    this.data = data;
  }

  toJson(): Json {
    const obj = toJson(this.data) as Record<string, Json>;
    obj.message = this.message;
    if (this.stack) obj.stack = this.stack;
    return obj;
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
