import { SerializableType } from "../types";

// regex to identify a bytes type
export const bytesPattern = /^bytes\d*$/;
// regex to identify digits
export const digitsPattern = /\d+$/;
// regex to identify a uint type
export const uintPattern = /^(uint|number)\d+$/;
// regex to identify a number type specifically
export const numberPattern = /^number/;

export function copyType(type: SerializableType): SerializableType {
  return JSON.parse(JSON.stringify(type));
}
