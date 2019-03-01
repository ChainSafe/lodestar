import assert from "assert";

import {
  ByteArray,
  SerializableArray,
  SerializableList,
  SerializableObject,
  SerializableType,
  SerializableValue,
} from "./types";

import { BYTES_PER_LENGTH_PREFIX } from "./constants";

function _sizeByteArray(value: ByteArray, type: SerializableType, typeLength: number): number {
  if (!isNaN(typeLength)) {
    assert(typeLength > 0, `Invalid byte array type: ${type}`);
    return typeLength + BYTES_PER_LENGTH_PREFIX;
  }
  return value.length + BYTES_PER_LENGTH_PREFIX;
}

export function size(value: SerializableValue, type: SerializableType): number {
  if (typeof type === "string") {
    if (type === "bool") {
      assert(value === true || value === false, `Invalid bool value: ${value}`);
      return 1;
    }
    if (type.match(/^bytes\d*$/)) {
      value = value as ByteArray;
      assert(value.length !== undefined, `Invalid byte array value: ${value}`);
      const typeLength = parseInt(type.match(/\d+$/) as unknown as string);
      return _sizeByteArray(value, type, typeLength);
    }
    if (type.match(/^uint\d+$/)) {
      const bits = parseInt(type.match(/\d+$/) as unknown as string);
      assert([8, 16, 32, 64, 128, 256].find((b) => b === bits), `Invalid uint type: ${type}`);
      return bits / 8;
    }
  } else if (Array.isArray(type)) {
    assert((value as SerializableArray).length !== undefined, `Invalid array value: ${value}`);
    assert(type.length <= 2, `Invalid array type: ${type}`);
    const elementType = type[0];
    if (elementType === "byte") {
      return _sizeByteArray(value as ByteArray, type, parseInt(type[1] as string));
    }
    return (value as SerializableList)
      .map((v) => size(v, elementType))
      .reduce((a, b) => a + b) + BYTES_PER_LENGTH_PREFIX;
  } else if (type === Object(type)) {
    assert(value === Object(value), `Invalid object value: ${value}`);
    assert(Array.isArray(type.fields), `Invalid object type: ${type}`);
    return type.fields
      .map(([fieldName, fieldType]) => size((value as SerializableObject)[fieldName], fieldType))
      .reduce((a, b) => a + b) + BYTES_PER_LENGTH_PREFIX;
  }
  throw new Error(`Invalid type: ${type}`);
}
