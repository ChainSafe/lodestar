import {toHexString} from "../bytes.js";
import {LodestarError} from "../errors.js";
import {mapValues} from "../objects.js";

const MAX_DEPTH = 0;

type LogDataBasic = string | number | bigint | boolean | null | undefined;

export type LogData = LogDataBasic | Record<string, LogDataBasic> | LogDataBasic[] | Record<string, LogDataBasic>[];

/**
 * Renders any log Context to JSON up to one level of depth.
 *
 * By limiting recursiveness, it renders limited content while ensuring safer logging.
 * Consumers of the logger should ensure to send pre-formated data if they require nesting.
 */
export function logCtxToJson(arg: unknown, depth = 0, fromError = false): LogData {
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
      if (depth > MAX_DEPTH) {
        return "[object]";
      }

      if (arg instanceof Error) {
        let metadata: Record<string, unknown>;
        if (arg instanceof LodestarError) {
          if (fromError) {
            return "[LodestarErrorCircular]";
          } else {
            // Allow one extra depth level for LodestarError
            metadata = logCtxToJson(arg.getMetadata(), depth - 1, true) as Record<string, unknown>;
          }
        } else {
          metadata = {message: arg.message};
        }
        if (arg.stack) metadata.stack = arg.stack;
        return metadata as LogData;
      }

      if (Array.isArray(arg)) {
        return arg.map((item) => logCtxToJson(item, depth + 1)) as LogData;
      }

      return mapValues(arg as Record<string, unknown>, (item) => logCtxToJson(item, depth + 1)) as LogData;

    // Already valid JSON
    case "number":
    case "string":
    case "undefined":
    case "boolean":
      return arg;

    default:
      return String(arg);
  }
}

/**
 * Renders any log Context to a string up to one level of depth.
 *
 * By limiting recursiveness, it renders limited content while ensuring safer logging.
 * Consumers of the logger should ensure to send pre-formated data if they require nesting.
 */
export function logCtxToString(arg: unknown, depth = 0, fromError = false): string {
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
      if (depth > MAX_DEPTH) {
        return "[object]";
      }

      if (arg instanceof Error) {
        let metadata: string;
        if (arg instanceof LodestarError) {
          if (fromError) {
            return "[LodestarErrorCircular]";
          } else {
            // Allow one extra depth level for LodestarError
            metadata = logCtxToString(arg.getMetadata(), depth - 1, true);
          }
        } else {
          metadata = arg.message;
        }
        return `${metadata}\n${arg.stack || ""}`;
      }

      if (Array.isArray(arg)) {
        return arg.map((item) => logCtxToString(item, depth + 1)).join(", ");
      }

      return Object.entries(arg)
        .map(([key, value]) => `${key}=${logCtxToString(value, depth + 1)}`)
        .join(", ");

    case "number":
    case "string":
    case "undefined":
    case "boolean":
    default:
      return String(arg);
  }
}
