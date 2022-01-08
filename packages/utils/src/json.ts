import {toHexString} from "./bytes";
import {LodestarError} from "./errors";
import {mapValues} from "./objects";

/**
 * Renders any log Context to JSON up to one level of depth.
 *
 * By limiting recursiveness, it renders limited content while ensuring safer logging.
 * Consumers of the logger should ensure to send pre-formated data if they require nesting.
 */
export function logCtxToJson(arg: unknown, recursive = false, fromError = false): Json {
  switch (typeof arg) {
    case "bigint":
    case "symbol":
    case "function":
      return arg.toString();

    case "object":
      if (arg === null) return "null";

      if (arg instanceof Uint8Array) {
        return toHexString(arg);
      }

      // For any type that may include recursiveness break early at the first level
      // - Prevent recursive loops
      // - Ensures Error with deep complex metadata won't leak into the logs and cause bugs
      if (recursive) {
        return "[object]";
      }

      if (arg instanceof Error) {
        let metadata: Record<string, unknown>;
        if (arg instanceof LodestarError) {
          if (fromError) {
            return "[LodestarErrorCircular]";
          } else {
            metadata = logCtxToJson(arg.getMetadata(), false, true) as Record<string, unknown>;
          }
        } else {
          metadata = {message: arg.message};
        }
        if (arg.stack) metadata.stack = arg.stack;
        return metadata as Json;
      }

      if (Array.isArray(arg)) {
        return arg.map((item) => logCtxToJson(item, true));
      }

      return mapValues(arg as Record<string, unknown>, (item) => logCtxToJson(item, true));

    // Already valid JSON
    case "number":
    case "string":
    case "undefined":
    case "boolean":
    default:
      return arg;
  }
}

/**
 * Renders any log Context to a string up to one level of depth.
 *
 * By limiting recursiveness, it renders limited content while ensuring safer logging.
 * Consumers of the logger should ensure to send pre-formated data if they require nesting.
 */
export function logCtxToString(arg: unknown, recursive = false, fromError = false): string {
  switch (typeof arg) {
    case "bigint":
    case "symbol":
    case "function":
      return arg.toString();

    case "object":
      if (arg === null) return "null";

      if (arg instanceof Uint8Array) {
        return toHexString(arg);
      }

      // For any type that may include recursiveness break early at the first level
      // - Prevent recursive loops
      // - Ensures Error with deep complex metadata won't leak into the logs and cause bugs
      if (recursive) {
        return "[object]";
      }

      if (arg instanceof Error) {
        let metadata: string;
        if (arg instanceof LodestarError) {
          if (fromError) {
            return "[LodestarErrorCircular]";
          } else {
            metadata = logCtxToString(arg.getMetadata(), false, true);
          }
        } else {
          metadata = arg.message;
        }
        return `${metadata} ${arg.stack || ""}`;
      }

      if (Array.isArray(arg)) {
        return arg.map((item) => logCtxToString(item, true)).join(", ");
      }

      return Object.entries(arg)
        .map(([key, value]) => `${key}=${logCtxToString(value, true)}`)
        .join(", ");

    case "number":
    case "string":
    case "undefined":
    case "boolean":
    default:
      return String(arg);
  }
}
