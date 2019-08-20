/** @module ssz */
import {BitList, BitVector} from "@chainsafe/bit-utils";

import {
  AnySSZType,
  Bytes,
  ContainerType,
  FullSSZType,
  ListType,
  SerializableArray,
  SerializableValue,
  SerializableObject,
  Type,
  VectorType,
} from "./types";

import {BYTES_PER_CHUNK} from "./constants";

import {_assertValidValue} from "./assertValidValue";

import {fixedSize} from "./size";

import {
  chunkify,
  merkleize,
  mixInLength,
  pack,
} from "./util/hash";

import {
  isBasicType,
  parseType,
} from "./util/types";


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
 * // merkleize a BN bignumber
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
  switch (type.type) {
    case Type.uint:
    case Type.bool:
    case Type.byteVector:
      return merkleize(pack([value], type));
    case Type.bitVector:
      return merkleize(chunkify(Buffer.from((value as BitVector).toBitfield())), Math.floor((type.length + 255) / 256));
    case Type.bitList:
      return mixInLength(
        merkleize(chunkify(Buffer.from((value as BitList).toBitfield())), Math.floor((type.maxLength + 255) / 256)),
        (value as BitList).bitLength
      );
    case Type.byteList:
      const sizeOfByte = 1;
      const chunkCount = Math.floor((type.maxLength * sizeOfByte + 31) / BYTES_PER_CHUNK);
      return mixInLength(
        merkleize(pack([value], type), chunkCount), (value as Bytes).length);
    case Type.list:
      value = value as SerializableArray;
      if (isBasicType(type.elementType)) {
        const chunkCount = Math.floor((type.maxLength * fixedSize(type.elementType) + 31) / BYTES_PER_CHUNK);
        return mixInLength(
          merkleize(pack(value, (type as ListType).elementType), chunkCount), value.length);
      } else {
        return mixInLength(
          merkleize(value.map((v,i) => hashTreeRoot(v, (type as ListType).elementType)), type.maxLength),
          value.length);
      }
    case Type.vector:
      value = value as SerializableArray;
      if (isBasicType(type.elementType)) {
        return merkleize(pack(value, (type as VectorType).elementType));
      } else {
        return merkleize(value.map((v) => hashTreeRoot(v, (type as VectorType).elementType)));
      }
    case Type.container:
      type = type as ContainerType;
      return merkleize(type.fields
        .map(([fieldName, fieldType]) => hashTreeRoot((value as SerializableObject)[fieldName], fieldType)));
  }
}

