import BN from "bn.js";

import {
  AnyType,
  ArrayType,
  ContainerType,
  DeserializedValue,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  SSZType,
  Type,
  UintType,
} from "./types";

import { BYTES_PER_LENGTH_PREFIX } from "./constants";

import { parseType } from "./util/types";

function _deserializeUint(data: Buffer, type: UintType, start: number): DeserializedValue {
  const offset = start + type.byteLength;
  const bn = new BN(data.slice(start, offset), 16, "le");
  const value = (type.useNumber || type.byteLength <= 4) ? bn.toNumber() : bn;
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
  const length = data.readUIntLE(start, BYTES_PER_LENGTH_PREFIX);
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  const offset = index0 + length;
  let index = index0;
  const value: SerializableArray = [];
  for (; index < offset;) {
    const deserialized = _deserialize(data, type.elementType, index);
    index = deserialized.offset;
    value.push(deserialized.value);
  }
  return {
    offset,
    value,
  }
}

function _deserializeObject(data: Buffer, type: ContainerType, start: number): DeserializedValue {
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

export function _deserialize(data: Buffer, type: SSZType, start: number): DeserializedValue {
  switch (type.type) {
    case Type.uint:
      return _deserializeUint(data, type, start);
    case Type.bool:
      return _deserializeBool(data, start);
    case Type.byteList:
    case Type.byteVector:
      return _deserializeByteArray(data, start);
    case Type.list:
    case Type.vector:
      return _deserializeArray(data, type, start);
    case Type.container:
      return _deserializeObject(data, type, start);
  }
}

/**
 * Deserialize, according to the SSZ spec
 * @method deserialize
 * @param {Buffer} data
 * @param {AnyType} type
 * @returns {SerializableValue}
 */
export function deserialize(data: Buffer, type: AnyType): SerializableValue {
  const _type = parseType(type);
  return _deserialize(data, _type, 0).value;
}
