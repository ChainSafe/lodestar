/** @module ssz */
import assert from "assert";
import BN from "bn.js";
import {BitList, BitVector} from "@chainsafe/bit-utils";

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
} from "./types";

import {BYTES_PER_LENGTH_PREFIX} from "./constants";

import {parseType, isVariableSizeType} from "./util/types";
import {fixedSize} from "./size";


/**
 * Deserialize, according to the SSZ spec
 *
 * ```typescript
 * let data: Buffer = sszSerializedData;
 *
 * // deserialize a number
 * const n: number = deserialize(
 *   data,
 *   "uint32" // "uintN", N == length in bits, N <= 32
 * );
 *
 * // deserialize a BN bignumber
 * import BN from "bn.js";
 * const bn: BN = deserialize(
 *   data,
 *   "uint64" // "uintN", N == length in bits, N >= 64
 * );
 *
 * // deserialize a number (forced)
 * const m: number = deserialize(
 *   data,
 *   "number64" // "numberN", N == length in bits
 * );
 *
 * // deserialize a boolean
 * const b: boolean = deserialize(data, "bool");
 *
 * // deserialize a bit list
 * import {BitList} from "@chainsafe/bit-utils";
 * const bl: BitList = deserialize(data, {
 *   elementType: "bool",
 *   maxLength: 10, // max number of bits
 * });
 *
 * // deserialize a bit vector
 * import {BitVector} from "@chainsafe/bit-utils";
 * const bv: BitVector = deserialize(data, {
 *   elementType: "bool",
 *   length: 10, // length in bits
 * });
 *
 * // deserialize a variable-length byte array, max-length required
 * const buf1: Buffer = deserialize(data, {
 *   elementType: "byte", // "byte", "uint8", or "number8"
 *   maxLength: 10, // max number of bytes
 * });
 *
 * // deserialize a fixed-length byte array
 * const buf2: Buffer = serialize(
 *   data,
 *   "bytes2" // "bytesN", N == length in bytes
 * );
 *
 * // deserialize a variable-length array, max-length required
 * const arr1: number[] = deserialize(data, {
 *   elementType: "uint32",
 *   maxLength: 10, // max number of elements
 * });
 *
 * // deserialize a fixed-length array
 * const arr2: number[] = deserialize([0, 1, 2, 3, 4, 5], {
 *   elementType: "uint32",
 *   length: 6,
 * });
 *
 * // deserialize an object
 * interface myData {
 *   a: number;
 *   b: boolean;
 *   c: Buffer;
 * }
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "uint16"], // [fieldName, fieldType]
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * const obj: myData = deserialize(data, myDataType);
 * ```
  */
export function deserialize(data: Buffer, type: AnySSZType): any {
  const _type = parseType(type);
  if (!isVariableSizeType(_type)) {
    assert(fixedSize(_type) === data.length, "Incorrect data length");
  }
  return _deserialize(data, _type, 0, data.length);
}

/**
 * Low level deserialize
 * @ignore
 * @param type full ssz type
 * @param start starting index
 * @param end ending index
 */
export function _deserialize(data: Buffer, type: FullSSZType, start: number, end: number): SerializableValue {
  switch (type.type) {
    case Type.uint:
      return _deserializeUint(data, type, start);
    case Type.bool:
      return _deserializeBool(data, start);
    case Type.bitList:
      return _deserializeBitList(data, type, start, end);
    case Type.bitVector:
      return _deserializeBitVector(data, type, start, end);
    case Type.byteList:
    case Type.byteVector:
      return _deserializeByteArray(data, type, start, end);
    case Type.list:
    case Type.vector:
      return _deserializeArray(data, type, start, end);
    case Type.container:
      return _deserializeObject(data, type, start, end);
  }
}

/** @ignore */
function _deserializeUint(data: Buffer, type: UintType, start: number): Uint {
  const offset = start + type.byteLength;
  const uintData = data.slice(start, offset);
  if (type.byteLength > 6 && type.useNumber && uintData.equals(Buffer.alloc(type.byteLength, 255))) {
    return Infinity;
  } else {
    const bn = new BN(uintData, 16, "le");
    return (type.useNumber || type.byteLength <= 6) ? bn.toNumber() : bn;
  }
}

/** @ignore */
function _deserializeBool(data: Buffer, start: number): Bool {
  return data[start] ? true : false;
}

/** @ignore */
function _deserializeBitList(data: Buffer, type: BitListType, start: number, end: number): BitList {
  const bitlist = BitList.deserialize(data.slice(start, end));
  assert(bitlist.bitLength <= type.maxLength, 'BitList length greater than max length');
  return bitlist;
}

/** @ignore */
function _deserializeBitVector(data: Buffer, type: BitVectorType, start: number, end: number): BitVector {
  return BitVector.fromBitfield(data.slice(start, end), type.length);
}

/** @ignore */
function _deserializeByteArray(data: Buffer, type: BytesType, start: number, end: number): Bytes {
  const length = end - start;
  if (type.type === Type.byteList) {
    assert(length <= type.maxLength, 'Byte list length greater than max length');
  }
  const value = Buffer.alloc(length);
  data.copy(value, 0, start, end);
  return value;
}

/** @ignore */
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
      assert(currentOffset <= end, "Offset out of bounds");
      nextIndex = currentIndex + BYTES_PER_LENGTH_PREFIX;
      nextOffset = nextIndex === firstOffset
        ? end
        : start + data.readUIntLE(nextIndex, BYTES_PER_LENGTH_PREFIX);
      assert(currentOffset <= nextOffset, "Offsets must be increasing");
      value.push(
        _deserialize(data, type.elementType, currentOffset, nextOffset)
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
        _deserialize(data, type.elementType, index, nextIndex)
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
function _deserializeObject(data: Buffer, type: ContainerType, start: number, end: number): SerializableObject {
  let currentIndex = start;
  let nextIndex = currentIndex;
  const value: SerializableObject = {};
  // Since variable-sized values can be interspersed with fixed-sized values, we precalculate
  // the offset indices so we can more easily deserialize the fields in one pass
  // first we get the fixed sizes
  const fixedSizes: (number | false)[] = type.fields.map(([_, fieldType]) =>
    !isVariableSizeType(fieldType) && fixedSize(fieldType));
  // with the fixed sizes, we can read the offsets, and store for later
  let offsets: number[] = [];
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
      value[fieldName] = _deserialize(data, fieldType, offsets[offsetIndex], offsets[offsetIndex + 1]);
      offsetIndex++;
      currentIndex += BYTES_PER_LENGTH_PREFIX;
    } else { // fixed-sized field
      nextIndex = currentIndex + fieldSize;
      value[fieldName] = _deserialize(data, fieldType, currentIndex, nextIndex);
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
