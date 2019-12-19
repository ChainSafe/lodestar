/** @module ssz */
import {BitList} from "@chainsafe/bit-utils";

import {
  Bytes,
  FullSSZType,
  ListType,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  Type,
  VectorType,
  isVariableSizeType
} from "@chainsafe/ssz-type-schema";

import {BYTES_PER_LENGTH_PREFIX} from "../util/constants";


// Return the size in bytes of a fixed-sized type
// Will error if a variable-sized type is given
/** @ignore */
export function fixedSize(type: FullSSZType): number {
  switch (type.type) {
    case Type.uint:
      return type.byteLength;
    case Type.bool:
      return 1;
    case Type.bitVector:
      return Math.ceil(type.length / 8);
    case Type.byteVector:
      return type.length;
    case Type.vector:
      return fixedSize(type.elementType) * type.length;
    case Type.container:
      return type.fields
        .map(([, fieldType]) => fixedSize(fieldType))
        .reduce((a, b) => a + b, 0);
    default:
      throw new Error("fixedSize: invalid type");
  }
}

// Return the size of a variable-sized type, dependent on the value
// Will error if a fixed-sized type is given
/** @ignore */
export function variableSize(type: FullSSZType, value: SerializableValue): number {
  switch (type.type) {
    case Type.bitList:
      return Math.ceil(((value as BitList).bitLength + 1) / 8);
    case Type.byteList:
      return (value as Bytes).length;
    case Type.list:
      return (value as SerializableArray)
        .map((v) =>
          size((type as ListType).elementType, v) +
          (isVariableSizeType(type.elementType) ? BYTES_PER_LENGTH_PREFIX : 0))
        .reduce((a, b) => a + b, 0);
    case Type.vector:
      return (value as SerializableArray)
        .map((v) =>
          size((type as VectorType).elementType, v) +
          (isVariableSizeType(type.elementType) ? BYTES_PER_LENGTH_PREFIX : 0))
        .reduce((a, b) => a + b, 0);
    case Type.container:
      return type.fields
        .map(([fieldName, fieldType]) =>
          size(fieldType, (value as SerializableObject)[fieldName]) +
          (isVariableSizeType(fieldType) ? BYTES_PER_LENGTH_PREFIX : 0))
        .reduce((a, b) => a + b, 0);
    default:
      throw new Error("variableSize: invalid type");
  }
}

/** @ignore */
export function size(type: FullSSZType, value: SerializableValue): number {
  return isVariableSizeType(type) ? variableSize(type, value) : fixedSize(type);
}
