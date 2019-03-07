import assert from "assert";

import {
  ArrayType,
  ByteArray,
  ObjectType,
  SerializableArray,
  SerializableList,
  SerializableObject,
  SerializableType,
  SerializableValue,
} from "./types";

import { BYTES_PER_LENGTH_PREFIX } from "./constants";

import {
  bytesPattern,
  digitsPattern,
  isArrayType,
  isObjectType,
  uintPattern,
} from "./util/types";

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
    if (type.match(bytesPattern)) {
      value = value as ByteArray;
      assert(value.length !== undefined, `Invalid byte array value: ${value}`);
      const typeLength = parseInt(type.match(digitsPattern) as unknown as string);
      return _sizeByteArray(value, type, typeLength);
    }
    if (type.match(uintPattern)) {
      const bits = parseInt(type.match(digitsPattern) as unknown as string);
      assert([8, 16, 32, 64, 128, 256].find((b) => b === bits), `Invalid uint type: ${type}`);
      return bits / 8;
    }
  } else if (isArrayType(type)) {
    type = type as ArrayType;
    assert((value as SerializableArray).length !== undefined, `Invalid array value: ${value}`);
    const elementType = type[0];
    if (elementType === "byte") {
      return _sizeByteArray(value as ByteArray, type, parseInt(type[1] as string));
    }
    return (value as SerializableList)
      .map((v) => size(v, elementType))
      .reduce((a, b) => a + b) + BYTES_PER_LENGTH_PREFIX;
  } else if (isObjectType(type)) {
    type = type as ObjectType;
    assert(value === Object(value), `Invalid object value: ${value}`);
    return type.fields
      .map(([fieldName, fieldType]) => size((value as SerializableObject)[fieldName], fieldType))
      .reduce((a, b) => a + b) + BYTES_PER_LENGTH_PREFIX;
  }
  throw new Error(`Invalid type: ${type}`);
}
