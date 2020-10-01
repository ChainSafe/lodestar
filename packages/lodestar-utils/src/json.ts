import {Json, toHexString} from "@chainsafe/ssz";
import {mapValues, pick} from "lodash";
import {LodestarError} from "./errors";

export function errorToJson(obj: Error): Json {
  return pick(obj, Object.getOwnPropertyNames(obj)) as Json;
}

export function toJson(arg: unknown): Json {
  switch (typeof arg) {
    case "bigint":
    case "symbol":
    case "function":
      return arg.toString();

    case "object":
      if (arg === null) return "null";
      if (Array.isArray(arg)) return arg.map(toJson);
      if (arg instanceof Uint8Array) return toHexString(arg);
      if (arg instanceof LodestarError) return arg.toJson();
      if (arg instanceof Error) return errorToJson(arg);
      return mapValues(arg, (value) => toJson(value)) as Json;

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
      if (json === null) return "null";
      if (Array.isArray(json)) return json.map(toJson).join(", ");
      const s = Object.entries(json)
        .map(([key, value]) => `${key}=${toString(value, true)}`)
        .join(", ");
      return nested ? `[${s}]` : s;
    }

    case "number":
    case "string":
    case "boolean":
    default:
      return String(json);
  }
}
