import {Json, toHexString} from "@chainsafe/ssz";
import {LodestarError} from "./errors";

export function toJson(arg: unknown): Json {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const copyArg: any = {};

  switch (typeof arg) {
    case "bigint":
    case "symbol":
    case "function":
      return arg.toString();

    case "object":
      if (arg === null) return "null";
      if (arg instanceof Uint8Array) return toHexString(arg);
      if (arg instanceof LodestarError) return toJson(arg.toObject());
      if (arg instanceof Error) return toJson(errorToObject(arg));
      Object.entries(arg).forEach(([k, v]) => (copyArg[k] = toJson(v)));
      return copyArg as Json;

    // Already valid JSON
    case "number":
    case "string":
    case "undefined":
    case "boolean":
    default:
      return arg as Json;
  }
}

export function toString(json: Json, nested = false): string {
  switch (typeof json) {
    case "object": {
      if (nested) return JSONStringifyCircular(json);
      if (json === null) return "null";
      if (Array.isArray(json)) return json.map((item) => toString(item, true)).join(", ");
      return Object.entries(json)
        .map(([key, value]) => `${key}=${toString(value, true)}`)
        .join(", ");
    }

    case "number":
    case "string":
    case "boolean":
    default:
      return String(json);
  }
}

function errorToObject(err: Error): Json {
  return {
    message: err.message,
    ...(err.stack ? {stack: err.stack} : {}),
  };
}

/**
 * Does not throw on circular references, prevent silencing the actual logged error
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function JSONStringifyCircular(value: any): string {
  try {
    return JSON.stringify(value);
  } catch (e) {
    if (e instanceof TypeError && e.message.includes("circular")) {
      return "ERROR_CIRCULAR_REFERENCE";
    } else {
      throw e;
    }
  }
}
