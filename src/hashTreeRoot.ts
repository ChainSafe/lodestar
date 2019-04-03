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

import {
  merkleize,
  mixInLength,
  pack,
} from "./util/hash";

import {
  isBasicType,
  parseType,
} from "./util/types";

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

/**
 * Merkleize an SSZ value
 * @method hashTreeRoot
 * @param {SerializableValue} value
 * @param {AnySSZType} type
 * @returns {Buffer}
 */
export function hashTreeRoot(value: SerializableValue, type: AnySSZType): Buffer {
  const _type = parseType(type);
  return _hashTreeRoot(value, _type);
}
