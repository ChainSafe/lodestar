/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */
import {BitList, BitVector} from "@chainsafe/bit-utils";
import BN from "bn.js";

import {
  AnySSZType,
  ArrayType,
  BitListType,
  BitVectorType,
  Bool,
  Bytes,
  BytesType,
  ContainerType,
  FullSSZType,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  Type,
  Uint,
  UintType,
  isVariableSizeType,
  parseType
} from "@chainsafe/ssz-type-schema";
import {BYTES_PER_LENGTH_PREFIX} from "../util/constants";
import {fixedSize, size} from "./size";
import {_assertValidValue} from "./assertValidValue";

import  {toBufferLE} from "bigint-buffer";

/**
 * Serialize, according to the SSZ spec
 *
 * ```typescript
 * let buf: Buffer;
 *
 * // serialize a number
 * buf = serialize(
 *   "number64", // "numberN", N == length in bits
 *   10,
 * );
 *
 * // serialize a BigInt
 * buf = serialize("bigint64", BigInt("1000000000000000000"));
 *
 * // serialize a BN
 * import BN from "bn.js";
 * buf = serialize("bn64", new BN("1000000000000000000"));
 *
 * // serialize a boolean
 * buf = serialize("bool", true);
 *
 * // serialize a bit list
 * import {BitList} from "@chainsafe/bit-utils";
 * buf = serialize({
 *   elementType: "bool",
 *   maxLength: 10, // max number of bits
 * }, BitList.fromBitfield(Buffer.alloc(1), 8));
 *
 * // serialize a bit vector
 * import {BitVector} from "@chainsafe/bit-utils";
 * buf = serialize({
 *   elementType: "bool",
 *   length: 8, // length in bits
 * }, BitVector.fromBitfield(Buffer.alloc(1), 8));
 *
 * // serialize a variable-length byte array, max-length required
 * buf = serialize({
 *   elementType: "byte", // "byte", or "number8"
 *   maxLength: 10, // max number of bytes
 * }, Buffer.from("abcd", "hex"));
 *
 * // serialize a fixed-length byte array
 * buf = serialize(
 *   "bytes2", // "bytesN", N == length in bytes
 *   Buffer.from("abcd", "hex"),
 * );
 *
 * // serialize a variable-length array, max-length required
 * buf = serialize({
 *   elementType: "number32",
 *   maxLength: 10, // max number of elements
 * }, [0, 1, 2, 3, 4, 5]);
 *
 * // serialize a fixed-length array
 * buf = serialize({
 *   elementType: "number32",
 *   length: 6,
 * }, [0, 1, 2, 3, 4, 5]);
 *
 * // serialize an object
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "number16"], // [fieldName, fieldType]
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * buf = serialize(myDataType, {a: 10, b: false, c: Buffer.alloc(96)});
 * ```
 */

export function serialize(type: AnySSZType, value: any): Buffer {
  const _type = parseType(type);
  _assertValidValue(_type, value);
  const buf = Buffer.alloc(size(_type, value));
  _serialize(_type, value, buf, 0);
  return buf;
}

/** @ignore */
function _serializeUint(type: UintType, value: Uint, output: Buffer, start: number): number {
  const offset = start + type.byteLength;
  let buf: Buffer;
  if (type.use === "bn" || BN.isBN(value)) {
    buf = (new BN(value as number)).toArrayLike(Buffer, "le", type.byteLength);
  } else {
    let biValue: bigint;
    if (type.use === "number" && type.byteLength > 6 && value === Infinity) {
      biValue = BigInt("0x" + Buffer.alloc(type.byteLength, 255).toString("hex"));
    } else {
      biValue = BigInt(value);
    }
    buf = toBufferLE(biValue, type.byteLength);
  }
  buf.copy(output, start);
  return offset;
}

/** @ignore */
function _serializeBool(value: Bool, output: Buffer, start: number): number {
  const offset = start + 1;
  if (value) {
    output.writeUInt8(1, start);
  } else {
    output.writeUInt8(0, start);
  }
  return offset;
}

/** @ignore */
function _serializeBitList(type: BitListType, value: BitList, output: Buffer, start: number): number {
  const serialized = Buffer.from(value.serialize());
  const offset = start + serialized.length;
  serialized.copy(output, start);
  return offset;
}

/** @ignore */
function _serializeBitVector(type: BitVectorType, value: BitVector, output: Buffer, start: number): number {
  const serialized = Buffer.from(value.toBitfield());
  const offset = start + serialized.length;
  serialized.copy(output, start);
  return offset;
}

/** @ignore */
function _serializeByteArray(type: BytesType, value: Bytes, output: Buffer, start: number): number {
  const length = type.type === Type.byteVector ? type.length : value.length;
  const offset = start + length;
  (Buffer.isBuffer(value) ? value : Buffer.from(value))
    .copy(output, start);
  return offset;
}

/** @ignore */
function _serializeArray(type: ArrayType, value: SerializableArray, output: Buffer, start: number): number {
  let index = start;
  if (isVariableSizeType(type.elementType)) {
    // all elements are variable-size
    let fixedIndex = index;
    let currentOffsetIndex = start + value.length * BYTES_PER_LENGTH_PREFIX;
    let nextOffsetIndex = currentOffsetIndex;
    for (const v of value) {
      // write serialized element to variable section
      nextOffsetIndex = _serialize(type.elementType, v, output, currentOffsetIndex);
      // write offset
      output.writeUIntLE(currentOffsetIndex - start, fixedIndex, BYTES_PER_LENGTH_PREFIX);
      // update offset
      currentOffsetIndex = nextOffsetIndex;
      fixedIndex += BYTES_PER_LENGTH_PREFIX;
    }
    index = currentOffsetIndex;
  } else {
    // all elements are fixed-size
    for (const v of value) {
      index = _serialize(type.elementType, v, output, index);
    }
  }
  return index;
}

/** @ignore */
function _serializeObject(type: ContainerType, value: SerializableObject, output: Buffer, start: number): number {
  let fixedIndex = start;
  const fixedLength = type.fields
    .map(([, fieldType]) => isVariableSizeType(fieldType) ? BYTES_PER_LENGTH_PREFIX : fixedSize(fieldType))
    .reduce((a, b) => a + b, 0);
  let currentOffsetIndex = start + fixedLength;
  let nextOffsetIndex = currentOffsetIndex;
  for (const [fieldName, fieldType] of type.fields) {
    if (isVariableSizeType(fieldType)) {
      // field type is variable-size
      // write serialized element to variable section
      nextOffsetIndex = _serialize(fieldType, value[fieldName], output, currentOffsetIndex);
      // write offset
      output.writeUIntLE(currentOffsetIndex - start, fixedIndex, BYTES_PER_LENGTH_PREFIX);
      // update offset
      currentOffsetIndex = nextOffsetIndex;
      fixedIndex += BYTES_PER_LENGTH_PREFIX;
    } else {
      fixedIndex = _serialize(fieldType, value[fieldName], output, fixedIndex);
    }
  }
  return currentOffsetIndex;
}

/**
 * Low level serialize
 * @ignore
 * @param type full ssz type
 * @param output buffer for writing serialized data
 * @param start starting index
 */
export function _serialize(type: FullSSZType, value: SerializableValue, output: Buffer, start: number): number {
  switch(type.type) {
    case Type.bool:
      return _serializeBool(value as Bool, output, start);
    case Type.uint:
      return _serializeUint(type, value as Uint, output, start);
    case Type.bitList:
      return _serializeBitList(type, value as BitList, output, start);
    case Type.bitVector:
      return _serializeBitVector(type, value as BitVector, output, start);
    case Type.byteList:
    case Type.byteVector:
      return _serializeByteArray(type, value as Bytes, output, start);
    case Type.list:
    case Type.vector:
      return _serializeArray(type, value as SerializableArray, output, start);
    case Type.container:
      return _serializeObject(type, value as SerializableObject, output, start);
  }
}
