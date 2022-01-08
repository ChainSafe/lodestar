import {toHexString} from "./bytes";
import {LodestarError} from "./errors";
import {mapValues} from "./objects";

export const CIRCULAR_REFERENCE_TAG = "CIRCULAR_REFERENCE";

export function toJson(arg: unknown, recursive = false): unknown {
  switch (typeof arg) {
    case "bigint":
    case "symbol":
    case "function":
      return arg.toString();

    case "object":
      if (arg === null) return "null";

      // Prevent recursive loops
      if (recursive) {
        return "[object]";
      }

      if (arg instanceof Uint8Array) return toHexString(arg);
      if (arg instanceof LodestarError) return toJson(arg.toObject(), false);
      if (arg instanceof Error) return toJson(errorToObject(arg), false);
      if (Array.isArray(arg)) return arg.map((item) => toJson(item, true));
      return mapValues(arg as Record<string, unknown>, (item) => toJson(item, true));

    // Already valid JSON
    case "number":
    case "string":
    case "undefined":
    case "boolean":
    default:
      return arg;
  }
}

export function toString(json: unknown, recursive = false): string {
  switch (typeof json) {
    case "object": {
      if (json === null) return "null";
      if (Array.isArray(json)) return json.map((item) => toString(item, true)).join(", ");
      else {
        if (recursive) {
          return "[object]";
        }

        return Object.entries(json)
          .map(([key, value]) => `${key}=${toString(value, true)}`)
          .join(", ");
      }
    }

    case "number":
    case "string":
    case "boolean":
    default:
      return String(json);
  }
}

function errorToObject(err: Error): Record<string, unknown> {
  return {
    message: err.message,
    ...(err.stack ? {stack: err.stack} : {}),
  };
}
