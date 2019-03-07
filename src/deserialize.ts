import assert from "assert";
import BN from "bn.js";

import {
  ArrayType,
  DeserializedValue,
  ObjectType,
  SerializableType,
  SerializableObject,
  SerializableValue,
  SerializableList,
} from "./types";

import { BYTES_PER_LENGTH_PREFIX } from "./constants";

import {
  bytesPattern,
  digitsPattern,
  numberPattern,
  uintPattern,
} from "./util/types";

function _deserializeUint(data: Buffer, byteLength: number, alwaysNumber: boolean, start: number): DeserializedValue {
  const offset = start + byteLength;
  const bn = new BN(data.slice(start, offset), 16, "le");
  const value = (alwaysNumber || byteLength <= 4) ? bn.toNumber() : bn;
  return {
    offset,
    value,
  }
}

function _deserializeBool(data: Buffer, start: number): DeserializedValue {
  return {
    offset: start + 1,
    value: data[start] ? true : false,
  }
}

function _deserializeByteArray(data: Buffer, start: number): DeserializedValue {
  const length = data.readUIntLE(start, BYTES_PER_LENGTH_PREFIX);
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  const offset = index0 + length;
  const value = Buffer.alloc(length);
  data.copy(value, 0, index0, offset);
  return {
    offset,
    value,
  }
}

function _deserializeArray(data: Buffer, type: ArrayType, start: number): DeserializedValue {
  const elementType = type[0];
  if (elementType === "byte") {
    return _deserializeByteArray(data, start);
  }
  const length = data.readUIntLE(start, BYTES_PER_LENGTH_PREFIX);
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  const offset = index0 + length;
  let index = index0;
  const value: SerializableList = [];
  for (; index < offset;) {
    const deserialized = _deserialize(data, elementType, index);
    index = deserialized.offset;
    value.push(deserialized.value);
  }
  return {
    offset,
    value,
  }
}

function _deserializeObject(data: Buffer, type: ObjectType, start: number): DeserializedValue {
  const length = data.readUIntLE(start, BYTES_PER_LENGTH_PREFIX);
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  const offset = index0 + length;
  let index = index0;
  const value: SerializableObject = {};
  for (const [fieldName, fieldType] of type.fields) {
    const deserialized = _deserialize(data, fieldType, index);
    index = deserialized.offset;
    value[fieldName] = deserialized.value;
  }
  return {
    offset,
    value,
  }
}

export function _deserialize(data: Buffer, type: SerializableType, start: number): DeserializedValue {
  if (typeof type === "string") {
    if (type === "bool") {
      return _deserializeBool(data, start);
    }
    if (type.match(bytesPattern)) {
      return _deserializeByteArray(data, start);
    }
    if (type.match(uintPattern)) {
      const useNumber = Array.isArray(type.match(numberPattern));
      const bits = parseInt(type.match(digitsPattern) as unknown as string);
      assert([8, 16, 32, 64, 128, 256].find((b) => b === bits), `Invalid uint type: ${type}`);
      return _deserializeUint(data, bits / 8, useNumber, start);
    }
  } else if (Array.isArray(type)) {
    assert(type.length <= 2, `Invalid array type: ${type}`);
    return _deserializeArray(data, type, start);
  } else if (type === Object(type)) {
    assert(Array.isArray(type.fields), `Invalid object type: ${type}`);
    return _deserializeObject(data, type, start);
  }
  throw new Error(`Invalid type: ${type}`);
}

/**
 * Deserialize, according to the SSZ spec
 * @method deserialize
 * @param {Buffer} data
 * @param {SerializableType} type
 * @returns {SerializableType}
 */
export function deserialize(data: Buffer, type: SerializableType): SerializableValue {
  return _deserialize(data, type, 0).value;
}
