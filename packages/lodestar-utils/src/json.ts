import {Json, toHexString} from "@chainsafe/ssz";

export function defaultErrorToJson(obj: Error): Json {
  const errObj: Json = {message: obj.message};
  if (obj.stack) errObj.stack = obj.stack;
  return errObj;
}

interface ICustomError extends Error {
  toJson?: () => Json;
}

export function toJson(obj: unknown): Json {
  if (obj == null) {
    return null;
  } else if (typeof obj === "number" || typeof obj === "string") {
    return obj;
  } else if (typeof obj === "bigint") {
    return String(obj);
  } else if (obj instanceof Uint8Array) {
    return toHexString(obj);
  } else if (obj instanceof Error) {
    return (obj as ICustomError).toJson?.() ?? defaultErrorToJson(obj);
  } else if (Array.isArray(obj)) {
    return obj.map(toJson);
  } else if (typeof obj === "object") {
    const jsonObj: Json = {};
    Object.entries(obj as object).forEach(([k, v]) => (jsonObj[k] = toJson(v)));
    return jsonObj;
  }
  throw new Error("Unable to convert unknown to json");
}
