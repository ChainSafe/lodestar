/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */
import assert from "assert";
import {BitList, BitVector} from "@chainsafe/bit-utils";
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
  BytesType,
  BitListType,
  BitVectorType,
  parseType,
  isVariableSizeType,
  UintImpl
} from "@chainsafe/ssz-type-schema";
import {BYTES_PER_LENGTH_PREFIX} from "../util/constants";
import {fixedSize} from "./size";
import {toBigIntLE} from "bigint-buffer";


/**
 * Deserialize, according to the SSZ spec
 *
 * ```typescript
 * let data: Buffer = sszSerializedData;
 *
 * // deserialize a number
 * const n: number = deserialize(
 *   "number32", // "numberN", N == length in bits
 *   data
 * );
 *
 * // deserialize a BigInt
 * const bi: bigint = deserialize(
 *   "bigint64", // "bigintN", N == length in bits
 *   data,
 * );
 *
 * // deserialize a BN
 * const bn: BN = deserialize("bn64", data);
 *
 * // deserialize a boolean
 * const b: boolean = deserialize("bool", data);
 *
 * // deserialize a bit list
 * import {BitList} from "@chainsafe/bit-utils";
 * const bl: BitList = deserialize({
 *   elementType: "bool",
 *   maxLength: 10, // max number of bits
 * }, data);
 *
 * // deserialize a bit vector
 * import {BitVector} from "@chainsafe/bit-utils";
 * const bv: BitVector = deserialize({
 *   elementType: "bool",
 *   length: 10, // length in bits
 * }, data);
 *
 * // deserialize a variable-length byte array, max-length required
 * const buf1: Buffer = deserialize({
 *   elementType: "byte", // "byte" or "number8"
 *   maxLength: 10, // max number of bytes
 * }, data);
 *
 * // deserialize a fixed-length byte array
 * const buf2: Buffer = serialize(
 *   "bytes2", // "bytesN", N == length in bytes
 *   data
 * );
 *
 * // deserialize a variable-length array, max-length required
 * const arr1: number[] = deserialize({
 *   elementType: "number32",
 *   maxLength: 10, // max number of elements
 * }, data);
 *
 * // deserialize a fixed-length array
 * const arr2: number[] = deserialize({
 *   elementType: "number32",
 *   length: 6,
 * }, [0, 1, 2, 3, 4, 5]);
 *
 * // deserialize an object
 * interface myData {
 *   a: number;
 *   b: boolean;
 *   c: Buffer;
 * }
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "number16"], // [fieldName, fieldType]
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * const obj: myData = deserialize(myDataType, data);
 * ```
  */
export function deserialize<T>(type: AnySSZType<T>, data: Buffer): T {
  const _type = parseType(type);
  if (!isVariableSizeType(_type)) {
    assert(fixedSize(_type) === data.length, "Incorrect data length");
  }
  return _deserialize(_type, data, 0, data.length) as unknown as T;

}

/**
 * Low level deserialize
 * @ignore
 * @param type full ssz type
 * @param start starting index
 * @param end ending index
 */
export function _deserialize(type: FullSSZType, data: Buffer, start: number, end: number): SerializableValue {
  switch (type.type) {
    case Type.uint:
      return _deserializeUint(type, data, start);
    case Type.bool:
      return _deserializeBool(data, start);
    case Type.bitList:
      return _deserializeBitList(type, data, start, end);
    case Type.bitVector:
      return _deserializeBitVector(type, data, start, end);
    case Type.byteList:
    case Type.byteVector:
      return _deserializeByteArray(type, data, start, end);
    case Type.list:
    case Type.vector:
      return _deserializeArray(type, data, start, end);
    case Type.container:
      return _deserializeObject(type, data, start, end);
  }
}

/** @ignore */
function _deserializeUint(type: UintType, data: Buffer, start: number): Uint {
  const offset = start + type.byteLength;
  const uintData = data.slice(start, offset);
  switch (type.use) {
    case UintImpl.bn:
      return new BN(uintData, 16, "le");
    case UintImpl.bigint:
      return toBigIntLE(uintData);
    case UintImpl.number:
      if (type.byteLength > 6 && uintData.equals(Buffer.alloc(type.byteLength, 255))) {
        return Infinity;
      }
      return Number(toBigIntLE(uintData));
  }
}

/** @ignore */
function _deserializeBool(data: Buffer, start: number): Bool {
  return data[start] ? true : false;
}

/** @ignore */
function _deserializeBitList(type: BitListType, data: Buffer, start: number, end: number): BitList {
  const bitlist = BitList.deserialize(data.slice(start, end));
  assert(bitlist.bitLength <= type.maxLength, "BitList length greater than max length");
  return bitlist;
}

/** @ignore */
function _deserializeBitVector(type: BitVectorType, data: Buffer, start: number, end: number): BitVector {
  return BitVector.fromBitfield(data.slice(start, end), type.length);
}

/** @ignore */
function _deserializeByteArray(type: BytesType, data: Buffer, start: number, end: number): Bytes {
  const length = end - start;
  if (type.type === Type.byteList) {
    assert(length <= type.maxLength, "Byte list length greater than max length");
  }
  const value = Buffer.alloc(length);
  data.copy(value, 0, start, end);
  return value;
}

/** @ignore */
function _deserializeArray(type: ArrayType, data: Buffer, start: number, end: number): SerializableArray {
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
      assert(currentOffset <= end, "Offset out of bounds");
      nextIndex = currentIndex + BYTES_PER_LENGTH_PREFIX;
      nextOffset = nextIndex === firstOffset
        ? end
        : start + data.readUIntLE(nextIndex, BYTES_PER_LENGTH_PREFIX);
      assert(currentOffset <= nextOffset, "Offsets must be increasing");
      value.push(
        _deserialize(type.elementType, data, currentOffset, nextOffset)
      );
      currentIndex = nextIndex;
      currentOffset = nextOffset;
    }
    assert(firstOffset === currentIndex, "First offset skips variable data");
  } else {
    // all elements fixed-sized
    let index = start;
    const elementSize = fixedSize(type.elementType);
    let nextIndex;
    for (; index < end;) {
      nextIndex = index + elementSize;
      value.push(
        _deserialize(type.elementType, data, index, nextIndex)
      );
      index = nextIndex;
    }
  }
  if (type.type === Type.vector) {
    assert(type.length === value.length, "Incorrect deserialized vector length");
  }
  if (type.type === Type.list) {
    assert(type.maxLength >= value.length, "List length greater than max length");
  }
  return value;
}

/** @ignore */
function _deserializeObject(type: ContainerType, data: Buffer, start: number, end: number): SerializableObject {
  let currentIndex = start;
  let nextIndex = currentIndex;
  const value: SerializableObject = {};
  // Since variable-sized values can be interspersed with fixed-sized values, we precalculate
  // the offset indices so we can more easily deserialize the fields in one pass
  // first we get the fixed sizes
  const fixedSizes: (number | false)[] = type.fields.map(([, fieldType]) =>
    !isVariableSizeType(fieldType) && fixedSize(fieldType));
  // with the fixed sizes, we can read the offsets, and store for later
  const offsets: number[] = [];
  const fixedEnd = fixedSizes.reduce((index: number, size) => {
    if (size === false) {
      offsets.push(start + data.readUIntLE(index, BYTES_PER_LENGTH_PREFIX));
      return index + BYTES_PER_LENGTH_PREFIX;
    } else {
      return index + size;
    }
  }, start);
  offsets.push(end);
  assert(fixedEnd === offsets[0], "Not all variable bytes consumed");
  let offsetIndex = 0;

  type.fields.forEach(([fieldName, fieldType], i) => {
    const fieldSize = fixedSizes[i];
    if (fieldSize === false) { // variable-sized field
      assert(offsets[offsetIndex] <= end, "Offset out of bounds");
      assert(offsets[offsetIndex] <= offsets[offsetIndex + 1], "Offsets must be increasing");
      value[fieldName] = _deserialize(fieldType, data, offsets[offsetIndex], offsets[offsetIndex + 1]);
      offsetIndex++;
      currentIndex += BYTES_PER_LENGTH_PREFIX;
    } else { // fixed-sized field
      nextIndex = currentIndex + fieldSize;
      value[fieldName] = _deserialize(fieldType, data, currentIndex, nextIndex);
      currentIndex = nextIndex;
    }
  });
  if (offsets.length > 1) {
    assert(offsetIndex === offsets.length - 1, "Not all variable bytes consumed");
    assert(currentIndex === offsets[0], "Not all fixed bytes consumed");
  } else {
    assert(currentIndex === end, "Not all fixed bytes consumed");
  }
  return value;
}
