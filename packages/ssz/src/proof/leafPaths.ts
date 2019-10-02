import {
  ArrayType,
  Bytes,
  SerializableValue,
  FullSSZType,
  Path,
  Type,
  SerializableArray,
  SerializableObject,
} from "@chainsafe/ssz-type-schema";
import {BitList} from "@chainsafe/bit-utils";

/**
 * Static and dynamic selectors
 */
export function leafPaths(value: SerializableValue, type: FullSSZType): Path[] {
  switch (type.type) {
    case Type.bool:
    case Type.uint:
      return [[]];
    case Type.bitList:
      return [...rangePaths((value as BitList).bitLength), ["__len__"]];
    case Type.bitVector:
    case Type.byteVector:
      return rangePaths(type.length);
    case Type.byteList:
      return [...rangePaths((value as Bytes).length), ["__len__"]];
    case Type.list:
      return [...arrayLeafPaths(value as SerializableArray, type), ["__len__"]];
    case Type.vector:
      return arrayLeafPaths(value as SerializableArray, type);
    case Type.container:
      return type.fields.flatMap(([fieldName, fieldType]) =>
        leafPaths((value as SerializableObject)[fieldName], fieldType).map((p) =>
          ([fieldName, ...p])));
  }
}

function rangePaths(end: number): Path[] {
  return Array.from({length: end}, (_,i) => [i]);
}

function arrayLeafPaths(value: SerializableArray, type: ArrayType): Path[] {
  return (value as SerializableArray).flatMap((v, i) =>
    leafPaths(v, type.elementType).map((p) =>
      ([i, ...p])));
}
