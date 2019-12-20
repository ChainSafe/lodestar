/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */
import {BitList, BitVector} from "@chainsafe/bit-utils";

import {
  AnySSZType,
  Bytes,
  ContainerType,
  FullSSZType,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  Type,
  isBasicType,
  parseType
} from "@chainsafe/ssz-type-schema";

import {_assertValidValue} from "./assertValidValue";

import {merkleize, mixInLength} from "./util/merkleize";
import {chunkCount, chunkify, pack} from "../util/chunk";

/**
 * Merkleize an SSZ value
 *
 * ```typescript
 * let buf: Buffer;
 *
 * // merkleize a number
 * buf = hashTreeRoot(
 *   "number64", // "numberN", N == length in bits
 *   10
 * );
 *
 * // merkleize a BigInt
 * buf = hashTreeRoot("bigint64", BigInt("1000000000000000000"));
 *
 * // merkleize a BN
 * import BN from "bn.js";
 * buf = hashTreeRoot("bigint64", new BN("1000000000000000000"));
 *
 * // merkleize a boolean
 * buf = hashTreeRoot("bool", true);
 *
 * // merkleize a bit list
 * import {BitList} from "@chainsafe/bit-utils";
 * buf = hashTreeRoot({
 *   elementType: "bool",
 *   maxLength: 10, // max number of bits
 * }, BitList.fromBitfield(Buffer.alloc(1), 8));
 *
 * // merkleize a bit vector
 * import {BitVector} from "@chainsafe/bit-utils";
 * buf = hashTreeRoot({
 *   elementType: "bool",
 *   length: 8, // length in bits
 * }, BitVector.fromBitfield(Buffer.alloc(1), 8));
 *
 * // merkleize a variable-length byte array, max-length required
 * buf = hashTreeRoot({
 *   elementType: "byte", // "byte" or "number8"
 *   maxLength: 10, // max number of bytes
 * }, Buffer.from("abcd", "hex"));
 *
 * // merkleize a fixed-length byte array
 * buf = hashTreeRoot(
 *   "bytes2", // "bytesN", N == length in bytes
 *   Buffer.from("abcd", "hex")
 * );
 *
 * // merkleize a variable-length array, max-length required
 * buf = hashTreeRoot({
 *   elementType: "number32",
 *   maxLength: 10, // max number of elements
 * }, [0, 1, 2, 3, 4, 5]);
 *
 * // merkleize a fixed-length array
 * buf = hashTreeRoot({
 *   elementType: "number32",
 *   length: 6,
 * }, [0, 1, 2, 3, 4, 5]);
 *
 * // merkleize an object
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "number16"], // [fieldName, fieldType]
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * buf = hashTreeRoot(myDataType, {a: 10, b: false, c: Buffer.alloc(96)});
 * ```
  */
export function hashTreeRoot(type: AnySSZType, value: any): Buffer {
  const _type = parseType(type);
  _assertValidValue(_type, value);
  return _hashTreeRoot(_type, value);
}

/**
 * Low level hashTreeRoot
 * @ignore
 * @param type full ssz type
 */
export function _hashTreeRoot(type: FullSSZType, value: SerializableValue): Buffer {
  let elementType: FullSSZType;
  switch (type.type) {
    case Type.uint:
    case Type.bool:
    case Type.byteVector:
      return merkleize(pack(type, [value]));
    case Type.bitVector:
      value = value as BitVector;
      return merkleize(chunkify(Buffer.from(value.toBitfield())), chunkCount(type));
    case Type.bitList:
      value = value as BitList;
      return mixInLength(
        merkleize(chunkify(Buffer.from(value.toBitfield())), chunkCount(type)),
        value.bitLength
      );
    case Type.byteList:
      value = value as Bytes;
      return mixInLength(
        merkleize(pack(type, [value]), chunkCount(type)),
        value.length
      );
    case Type.list:
      value = value as SerializableArray;
      elementType = type.elementType;
      if (isBasicType(elementType)) {
        return mixInLength(
          merkleize(pack(elementType, value), chunkCount(type)),
          value.length
        );
      } else {
        return mixInLength(
          merkleize(value.map((v) => _hashTreeRoot(elementType, v)), type.maxLength),
          value.length
        );
      }
    case Type.vector:
      value = value as SerializableArray;
      elementType = type.elementType;
      if (isBasicType(elementType)) {
        return merkleize(pack(elementType, value));
      } else {
        return merkleize(value.map((v) => _hashTreeRoot(elementType, v)));
      }
    case Type.container:
      type = type as ContainerType;
      return merkleize(
        type.fields.map(([fieldName, fieldType]) =>
          _hashTreeRoot(fieldType, (value as SerializableObject)[fieldName])));
  }
}

