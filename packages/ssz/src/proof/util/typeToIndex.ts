import assert from "assert";

import {
  FullSSZType,
  isBasicType,
  Type,
  Path,
  PathElement,
} from "@chainsafe/ssz-type-schema";

import {
  nextPowerOf2,
} from "../../util/bigintMath";

import {itemLength, chunkCount} from "../../util/chunk";
import {bit, byte} from "../../util/types";
import {GeneralizedIndex} from "./types";
import {alphasort} from "./alphasort";

/**
 * Return the type of the element of an object of the given type with the given index
 * or member variable name (eg. `7` for `x[7]`, `"foo"` for `x.foo`)
 */
export function getElementType(type: FullSSZType, indexOrFieldName: PathElement): FullSSZType {
  switch (type.type) {
    case Type.bitList:
    case Type.bitVector:
      return bit;
    case Type.byteList:
    case Type.byteVector:
      return byte;
    case Type.list:
    case Type.vector:
      return type.elementType;
    case Type.container:
      return type.fields.find(([fieldName]) => indexOrFieldName === fieldName)[1];
    default:
      throw new Error("unsupported type");
  }
}

/**
 * Return three variables:
 * (i) the index of the chunk in which the given element of the item is represented;
 * (ii) the starting byte position within the chunk;
 * (iii) the ending byte position within the chunk.
 *  For example: for a 6-item list of uint64 values, index=2 will return (0, 16, 24), index=5 will return (1, 8, 16)
 */
export function getItemPosition(type: FullSSZType, indexOrFieldName: PathElement): [number, number, number] {
  let start: number,
    elementItemLength: number;
  switch (type.type) {
    case Type.bitList:
    case Type.bitVector:
    case Type.byteList:
    case Type.byteVector:
    case Type.list:
    case Type.vector:
      indexOrFieldName = indexOrFieldName as number;
      assert(Number.isSafeInteger(indexOrFieldName));
      elementItemLength = itemLength(getElementType(type, indexOrFieldName));
      start = indexOrFieldName * elementItemLength;
      return [Math.floor(start / 32), start % 32, start % 32 + elementItemLength];
    case Type.container:
      indexOrFieldName = indexOrFieldName as string;
      assert(typeof indexOrFieldName === "string");
      return [
        type.fields.map(([fieldName]) => fieldName).indexOf(indexOrFieldName),
        0,
        itemLength(getElementType(type, indexOrFieldName)),
      ];
    default:
      throw new Error("unsupported type");
  }
}

function isListType(type: FullSSZType): boolean {
  return [
    Type.bitList,
    Type.byteList,
    Type.list
  ].includes(type.type);
}

/**
 * Converts a path (eg. `[7, "foo", 3]` for `x[7].foo[3]`, `[12, "bar", "__len__"]` for
 * `len(x[12].bar)`) into the generalized index representing its position in the Merkle tree.
 */
export function getGeneralizedIndex(type: FullSSZType, path: Path): GeneralizedIndex {
  let root = 1n;
  for (const p of path) {
    assert(!isBasicType(type));
    if (p === "__len__") {
      assert(isListType(type));
      return root * 2n + 1n;
    } else {
      const [pos] = getItemPosition(type, p);
      if (isListType(type)) {
        root *= 2n; // bit for length mix in
      }
      root = root * nextPowerOf2(BigInt(chunkCount(type))) + BigInt(pos);
      type = getElementType(type, p);
    }
  }
  return root;
}

/**
 * Converts paths into generalized indices, representing positions in a merkle tree
 * sorted in bit-alphabetical left-to-right order
 */
export function getGeneralizedIndices(type: FullSSZType, paths: Path[]): GeneralizedIndex[] {
  return alphasort(new Set(paths.map((p) => getGeneralizedIndex(type, p))));
}
