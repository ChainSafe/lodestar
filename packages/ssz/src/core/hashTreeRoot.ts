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
 *   10,
 *   "uint64" // "uintN", N == length in bits
 * );
 *
 * // merkleize a BigInt
 * buf = hashTreeRoot(BigInt("1000000000000000000"), "uint64");
 *
 * // merkleize a BN
 * import BN from "bn.js";
 * buf = hashTreeRoot(new BN("1000000000000000000"), "uint64");
 *
 * // merkleize a boolean
 * buf = hashTreeRoot(true, "bool");
 *
 * // merkleize a bit list
 * import {BitList} from "@chainsafe/bit-utils";
 * buf = hashTreeRoot(BitList.fromBitfield(Buffer.alloc(1), 8), {
 *   elementType: "bool",
 *   maxLength: 10, // max number of bits
 * });
 *
 * // merkleize a bit vector
 * import {BitVector} from "@chainsafe/bit-utils";
 * buf = hashTreeRoot(BitVector.fromBitfield(Buffer.alloc(1), 8), {
 *   elementType: "bool",
 *   length: 8, // length in bits
 * });
 *
 * // merkleize a variable-length byte array, max-length required
 * buf = hashTreeRoot(Buffer.from("abcd", "hex"), {
 *   elementType: "byte", // "byte", "uint8", or "number8"
 *   maxLength: 10, // max number of bytes
 * });
 *
 * // merkleize a fixed-length byte array
 * buf = hashTreeRoot(
 *   Buffer.from("abcd", "hex"),
 *   "bytes2" // "bytesN", N == length in bytes
 * );
 *
 * // merkleize a variable-length array, max-length required
 * buf = hashTreeRoot([0, 1, 2, 3, 4, 5], {
 *   elementType: "uint32",
 *   maxLength: 10, // max number of elements
 * });
 *
 * // merkleize a fixed-length array
 * buf = hashTreeRoot([0, 1, 2, 3, 4, 5], {
 *   elementType: "uint32",
 *   length: 6,
 * });
 *
 * // merkleize an object
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "uint16"], // [fieldName, fieldType]
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * buf = hashTreeRoot({a: 10, b: false, c: Buffer.alloc(96)}, myDataType);
 * ```
  */
export function hashTreeRoot(value: any, type: AnySSZType): Buffer {
  const _type = parseType(type);
  _assertValidValue(value, _type);
  return _hashTreeRoot(value, _type);
}

/**
 * Low level hashTreeRoot
 * @ignore
 * @param type full ssz type
 */
export function _hashTreeRoot(value: SerializableValue, type: FullSSZType): Buffer {
  let elementType: FullSSZType;
  switch (type.type) {
    case Type.uint:
    case Type.bool:
    case Type.byteVector:
      return merkleize(pack([value], type));
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
        merkleize(pack([value], type), chunkCount(type)),
        value.length
      );
    case Type.list:
      value = value as SerializableArray;
      elementType = type.elementType;
      if (isBasicType(elementType)) {
        return mixInLength(
          merkleize(pack(value, elementType), chunkCount(type)),
          value.length
        );
      } else {
        return mixInLength(
          merkleize(value.map((v) => _hashTreeRoot(v, elementType)), type.maxLength),
          value.length
        );
      }
    case Type.vector:
      value = value as SerializableArray;
      elementType = type.elementType;
      if (isBasicType(elementType)) {
        return merkleize(pack(value, elementType));
      } else {
        return merkleize(value.map((v) => _hashTreeRoot(v, elementType)));
      }
    case Type.container:
      type = type as ContainerType;
      return merkleize(
        type.fields.map(([fieldName, fieldType]) =>
          _hashTreeRoot((value as SerializableObject)[fieldName], fieldType)));
  }
}

