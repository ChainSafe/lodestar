import assert from "assert";

import {
  SerializableType, ObjectType,
} from "../types";

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

export function isArrayType(type: SerializableType): boolean {
  if (Array.isArray(type)) {
    assert(type.length <= 2, "ArrayType length must be less-than-equal to 2");
    return true;
  } else {
    return false;
  }
}

export function isObjectType(type: SerializableType): boolean {
  if (type === Object(type)) {
    type = type as ObjectType;
    assert(Array.isArray(type.fields), "ObjectType must have fields specified as an array");
    return true;
  } else {
    return false;
  }
}

