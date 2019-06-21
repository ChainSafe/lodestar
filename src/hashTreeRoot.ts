/** @module ssz */
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

import { assertValidValue } from "./assertValidValue";

import {
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
 * // merkleize a variable-length byte array
 * buf = hashTreeRoot(Buffer.from("abcd", "hex"), "bytes");
 *
 * // merkleize a fixed-length byte array
 * buf = hashTreeRoot(
 *   Buffer.from("abcd", "hex"),
 *   "bytes2" // "bytesN", N == length in bytes
 * );
 *
 * // merkleize a variable-length array
 * buf = hashTreeRoot(
 *   [0, 1, 2, 3, 4, 5],
 *   ["uint32"] // [elementType]
 * );
 *
 * // merkleize a fixed-length array
 * buf = hashTreeRoot(
 *   [0, 1, 2, 3, 4, 5],
 *   ["uint32", 6] // [elementType, arrayLength]
 * );
 *
 * // merkleize an object
 * const myDataType: SimpleContainerType = {
 *   name: "MyData",
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
  assertValidValue(value, _type);
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
      return merkleize(pack([value], type));
    case Type.bool:
      return merkleize(pack([value], type));
    case Type.byteList:
      return mixInLength(
        merkleize(pack([value], type)),
        (value as Bytes).length);
    case Type.byteVector:
      return merkleize(pack([value], type));
    case Type.list:
      value = value as SerializableArray;
      if (isBasicType(type.elementType)) {
        return mixInLength(
          merkleize(pack(value, (type as ListType).elementType)),
          value.length);
      } else {
        return mixInLength(
          merkleize(value.map((v) => hashTreeRoot(v, (type as ListType).elementType))),
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

