import BN from "bn.js";

import {
  AnyType,
  ArrayType,
  Bool,
  Bytes,
  BytesType,
  ContainerType,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  SSZType,
  Type,
  Uint,
  UintType,
} from "./types";

import { BYTES_PER_LENGTH_PREFIX } from "./constants";

import { size } from "./size";

import { parseType } from "./util/types";


function _serializeUint(value: Uint, type: UintType, output: Buffer, start: number): number {
  const offset = start + type.byteLength;
  (new BN(value)).addn(type.offset).toArrayLike(Buffer, "le", type.byteLength)
    .copy(output, start);
  return offset;
}

function _serializeBool(value: Bool, output: Buffer, start: number): number {
  const offset = start + 1;
  if (value) {
    output.writeUInt8(1, start);
  } else {
    output.writeUInt8(0, start);
  }
  return offset;
}

function _serializeByteArray(value: Bytes, type: BytesType, output: Buffer, start: number): number {
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  const length = (type as any).length || value.length;
  const offset = start + length + BYTES_PER_LENGTH_PREFIX;
  output.writeUIntLE(length, start, BYTES_PER_LENGTH_PREFIX);
  (Buffer.isBuffer(value) ? value : Buffer.from(value))
    .copy(output, index0);
  return offset;
}

function _serializeArray(value: SerializableArray, type: ArrayType, output: Buffer, start: number): number {
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  let index = index0;
  for (const v of (value as SerializableArray)) {
    index = _serialize(v, type.elementType, output, index);
  }
  output.writeUIntLE(index - index0, start, BYTES_PER_LENGTH_PREFIX)
  return index;
}

function _serializeObject(value: SerializableObject, type: ContainerType, output: Buffer, start: number): number {
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  let index = index0;
  for (const [fieldName, fieldType] of type.fields) {
    index = _serialize(value[fieldName], fieldType, output, index);
  }
  output.writeUIntLE(index - index0, start, BYTES_PER_LENGTH_PREFIX)
  return index;
}

export function _serialize(value: SerializableValue, type: SSZType, output: Buffer, start: number): number {
  switch(type.type) {
    case Type.bool:
      return _serializeBool(value as Bool, output, start);
    case Type.uint:
      return _serializeUint(value as Uint, type, output, start);
    case Type.byteList:
    case Type.byteVector:
      return _serializeByteArray(value as Bytes, type, output, start);
    case Type.list:
    case Type.vector:
      return _serializeArray(value as SerializableArray, type, output, start);
    case Type.container:
      return _serializeObject(value as SerializableObject, type, output, start);
  }
}

/**
 * Serialize, according to the SSZ spec
 * @method serialize
 * @param {SerializableValue} value
 * @param {AnyType} type
 * @returns {Buffer}
 */
export function serialize(value: SerializableValue, type: AnyType): Buffer {
  const _type = parseType(type);
  const buf = Buffer.alloc(size(value, _type));
  _serialize(value, _type, buf, 0);
  return buf;
}
