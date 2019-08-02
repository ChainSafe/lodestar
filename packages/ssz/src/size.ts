/** @module ssz */
import {BitList} from "@chainsafe/bit-utils";

import {
  Bytes,
  FullSSZType,
  SerializableArray,
  SerializableObject,
  Type,
  VectorType,
  ListType,
  SerializableValue,
} from "./types";

import {BYTES_PER_LENGTH_PREFIX} from "./constants";

import {isVariableSizeType} from "./util/types";


// Return the size of a fixed-sized type
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
        .map(([_, fieldType]) => fixedSize(fieldType))
        .reduce((a, b) => a + b, 0);
    default:
      throw new Error('fixedSize: invalid type');
  }
}

// Return the size of a variable-sized type, dependent on the value
// Will error if a fixed-sized type is given
/** @ignore */
export function variableSize(value: SerializableValue, type: FullSSZType): number {
  switch (type.type) {
    case Type.bitList:
      return Math.ceil(((value as BitList).bitLength + 1) / 8);
    case Type.byteList:
      return (value as Bytes).length;
    case Type.list:
      return (value as SerializableArray)
        .map((v) =>
          size(v, (type as ListType).elementType) +
          (isVariableSizeType(type.elementType) ? BYTES_PER_LENGTH_PREFIX : 0))
        .reduce((a, b) => a + b, 0);
    case Type.vector:
      return (value as SerializableArray)
        .map((v) =>
          size(v, (type as VectorType).elementType) +
          (isVariableSizeType(type.elementType) ? BYTES_PER_LENGTH_PREFIX : 0))
        .reduce((a, b) => a + b, 0);
    case Type.container:
      return type.fields
        .map(([fieldName, fieldType]) =>
          size((value as SerializableObject)[fieldName], fieldType) +
          (isVariableSizeType(fieldType) ? BYTES_PER_LENGTH_PREFIX : 0))
        .reduce((a, b) => a + b, 0);
    default:
      throw new Error('variableSize: invalid type');
  }
}

/** @ignore */
export function size(value: SerializableValue, type: FullSSZType): number {
  return isVariableSizeType(type) ? variableSize(value, type) : fixedSize(type);
}
