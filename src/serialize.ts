import BN from "bn.js";

import {
  ArrayType,
  Bool,
  ByteArray,
  ObjectType,
  SerializableArray,
  SerializableObject,
  SerializableType,
  SerializableValue,
  Uint,
  SerializableList,
} from "./types";

import { BYTES_PER_LENGTH_PREFIX } from "./constants";

import { size } from "./size";

import {
  bytesPattern,
  digitsPattern,
  isArrayType,
  isObjectType,
  uintPattern,
} from "./util/types";

function _serializeUint(value: Uint, byteLength: number, output: Buffer, start: number): number {
  const offset = start + byteLength;
  if (BN.isBN(value)) {
    value.toArrayLike(Buffer, "le", byteLength)
      .copy(output, start);
  } else {
    if (value >= 2**48) {
      (new BN(value)).toArrayLike(Buffer, "le", byteLength)
        .copy(output, start);
    } else {
      output.writeUIntLE(value, start, byteLength > 6 ? 6 : byteLength);
    }
  }
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

function _serializeByteArray(value: ByteArray, typeLength: number, output: Buffer, start: number): number {
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  const length = !isNaN(typeLength) ? typeLength : value.length;
  const offset = start + length + BYTES_PER_LENGTH_PREFIX;
  output.writeUIntLE(length, start, BYTES_PER_LENGTH_PREFIX);
  (Buffer.isBuffer(value) ? value : Buffer.from(value))
    .copy(output, index0);
  return offset;
}

function _serializeArray(value: SerializableArray, type: ArrayType, output: Buffer, start: number): number {
  const elementType = type[0];
  if (elementType === "byte") {
    return _serializeByteArray((value as ByteArray), parseInt(type[1] as string), output, start);
  }
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  let index = index0;
  for (const v of (value as SerializableList)) {
    index = _serialize(v, elementType, output, index);
  }
  output.writeUIntLE(index - index0, start, BYTES_PER_LENGTH_PREFIX)
  return index;
}

function _serializeObject(value: SerializableObject, type: ObjectType, output: Buffer, start: number): number {
  const index0 = start + BYTES_PER_LENGTH_PREFIX;
  let index = index0;
  for (const [fieldName, fieldType] of type.fields) {
    index = _serialize(value[fieldName], fieldType, output, index);
  }
  output.writeUIntLE(index - index0, start, BYTES_PER_LENGTH_PREFIX)
  return index;
}

export function _serialize(value: SerializableValue, type: SerializableType, output: Buffer, start: number): number {
  if (typeof type === "string") {
    if (type === "bool") {
      return _serializeBool(value as Bool, output, start);
    }
    if (type.match(bytesPattern)) {
      const typeLength = parseInt(type.match(digitsPattern) as unknown as string);
      return _serializeByteArray(value as ByteArray, typeLength, output, start);
    }
    if (type.match(uintPattern)) {
      const byteLength = parseInt(type.match(digitsPattern) as unknown as string) / 8;
      return _serializeUint(value as Uint, byteLength, output, start);
    }
  } else if (isArrayType(type)) {
    return _serializeArray(value as SerializableArray, type as ArrayType, output, start);
  } else if (isObjectType(type)) {
    return _serializeObject(value as SerializableObject, type as ObjectType, output, start);
  }
  throw new Error(`Invalid type: ${type}`);
}

/**
 * Serialize, according to the SSZ spec
 * @method serialize
 * @param {SerializableValue} value
 * @param {SerializableType} type
 * @returns {Buffer}
 */
export function serialize(value: SerializableValue, type: SerializableType): Buffer {
  const buf = Buffer.alloc(size(value, type));
  _serialize(value, type, buf, 0);
  return buf;
}
