import assert from "assert";
import BN from "bn.js";

import {
  AnySSZType,
  ArrayType,
  ContainerType,
  FullSSZType,
  SerializableArray,
  SerializableObject,
  Type,
  UintType,
  SerializableValue,
  Uint,
  Bool,
  Bytes,
} from "./types";

import { BYTES_PER_LENGTH_PREFIX } from "./constants";

import { parseType, isVariableSizeType } from "./util/types";
import { fixedSize } from "./size";

function _deserializeUint(data: Buffer, type: UintType, start: number): Uint {
  const offset = start + type.byteLength;
  const uintData = data.slice(start, offset);
  if (type.byteLength > 6 && type.useNumber && uintData.equals(Buffer.alloc(type.byteLength, 255))) {
    return Infinity;
  } else {
    const bn = (new BN(uintData, 16, "le")).sub(new BN(type.offset));
    return (type.useNumber || type.byteLength <= 6) ? bn.toNumber() : bn;
  }
}

function _deserializeBool(data: Buffer, start: number): Bool {
  return data[start] ? true : false;
}

function _deserializeByteArray(data: Buffer, start: number, end: number): Bytes {
  const length = end - start;
  const value = Buffer.alloc(length);
  data.copy(value, 0, start, end);
  return value;
}

function _deserializeArray(data: Buffer, type: ArrayType, start: number, end: number): SerializableArray {
  const value: SerializableArray = [];
  if (start === end) {
    return value;
  }
  if (isVariableSizeType(type.elementType)) {
    // all elements variable-sized
    // indices contain offsets
    let currentIndex = start;
    let nextIndex = currentIndex;
    // data exists between offsets
    const firstOffset = start + data.readUIntLE(start, BYTES_PER_LENGTH_PREFIX);
    let currentOffset = firstOffset;
    let nextOffset = currentOffset;
    // read off offsets, deserializing values until we hit the first offset index
    for (; currentIndex < firstOffset;) {
      nextIndex = currentIndex + BYTES_PER_LENGTH_PREFIX;
      nextOffset = start + data.readUIntLE(nextIndex, BYTES_PER_LENGTH_PREFIX);
      value.push(
        _deserialize(data, type.elementType, currentOffset, nextOffset)
      );
      currentIndex = nextIndex;
      currentOffset = nextOffset;
    }
    assert(currentOffset === end, "Not all variable bytes consumed");
  } else {
    // all elements fixed-sized
    let index = start;
    const elementSize = fixedSize(type.elementType);
    let nextIndex;
    for (; index < end;) {
      nextIndex = index + elementSize;
      value.push(
        _deserialize(data, type.elementType, index, nextIndex)
      );
      index = nextIndex;
    }
  }
  return value;
}

function _deserializeObject(data: Buffer, type: ContainerType, start: number, end: number): SerializableObject {
  let currentIndex = start;
  let nextIndex = currentIndex;
  const value: SerializableObject = {};
  // Since variable-sized values can be interspersed with fixed-sized values, we precalculate
  // the offset indices so we can more easily deserialize the fields in one pass
  // first we get the fixed sizes
  const fixedSizes = type.fields.map(([_, fieldType]) => !isVariableSizeType(fieldType) && fixedSize(fieldType));
  // with the fixed sizes, we can read the offsets, and store for later
  let offsets: number[] = [];
  fixedSizes.reduce((index: number, size, i) => {
    if (fixedSizes[i] === false) {
      offsets.push(start + data.readUIntLE(index, BYTES_PER_LENGTH_PREFIX));
      return index + BYTES_PER_LENGTH_PREFIX;
    } else {
      return index + (size as number);
    }
  }, start)
  offsets.push(end);
  let offsetIndex = 0;

  type.fields.forEach(([fieldName, fieldType], i) => {
    const fieldSize = fixedSizes[i];
    if (fieldSize === false) { // variable-sized field
      value[fieldName] = _deserialize(data, fieldType, offsets[offsetIndex], offsets[offsetIndex + 1]);
      offsetIndex++;
      currentIndex += BYTES_PER_LENGTH_PREFIX;
    } else { // fixed-sized field
      nextIndex = currentIndex + fieldSize;
      value[fieldName] = _deserialize(data, fieldType, currentIndex, nextIndex);
      currentIndex = nextIndex;
    }
  });
  return value;
}

export function _deserialize(data: Buffer, type: FullSSZType, start: number, end: number): SerializableValue {
  switch (type.type) {
    case Type.uint:
      return _deserializeUint(data, type, start);
    case Type.bool:
      return _deserializeBool(data, start);
    case Type.byteList:
    case Type.byteVector:
      return _deserializeByteArray(data, start, end);
    case Type.list:
    case Type.vector:
      return _deserializeArray(data, type, start, end);
    case Type.container:
      return _deserializeObject(data, type, start, end);
  }
}

/**
 * Deserialize, according to the SSZ spec
 * @method deserialize
 * @param {Buffer} data
 * @param {AnySSZType} type
 * @returns {any}
 */
export function deserialize(data: Buffer, type: AnySSZType): SerializableValue {
  const _type = parseType(type);
  return _deserialize(data, _type, 0, data.length);
}
