import assert from "assert";

import {
  FullSSZType,
  isBasicType,
  Type,
  Path,
  PathElement,
} from "@chainsafe/ssz-type-schema";

import {
  nextPowerOf2, bitLength,
} from "../../util/bigintMath";

import {itemLength, chunkCount} from "../../util/chunk";
import {bit, byte} from "../../util/types";
import {GeneralizedIndex} from "./types";
import {alphasort} from "./alphasort";
import { getPathIndices } from "./multiproof";

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
      if (isListType(type)) {
        root *= 2n; // bit for length mix in
      }
      const [pos] = getItemPosition(type, p);
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

export function getPaths(type: FullSSZType, index: GeneralizedIndex): Path[] {
  console.log(getPathIndices(index));
  return _getPaths(type, index, getPathIndices(index), 1n, []);
}

import {BitsType, BytesType, ArrayType} from "@chainsafe/ssz-type-schema";

function maxLength(type: BitsType | BytesType | ArrayType): number {
  switch (type.type) {
    case Type.bitList:
    case Type.byteList:
    case Type.list:
      return type.maxLength;
    case Type.bitVector:
    case Type.byteVector:
    case Type.vector:
      return type.length;
    default:
      throw new Error("");
  }
}


function _getPaths(type: FullSSZType, index: GeneralizedIndex, pathIndices: GeneralizedIndex[], currentIndex: GeneralizedIndex, currentPath: Path): Path[] {
  assert(!isBasicType(type));
  const prevIndex = currentIndex;
  const fullChunkCount = nextPowerOf2(BigInt(chunkCount(type)));
  if (type.type === Type.container) {
    currentIndex *= fullChunkCount;
    for (const [fieldName, fieldType] of type.fields) {
      const p = [...currentPath, fieldName];
      const fieldIndex = currentIndex + BigInt(getItemPosition(type, fieldName)[0]);
      if (fieldIndex === index) {
        return [p];
      }
      if (pathIndices.includes(fieldIndex)) {
        return _getPaths(fieldType, index, pathIndices, fieldIndex, p);
      }
    }
    throw new Error("no valid paths");
  } else {
    let pathIndexDelta = bitLength(fullChunkCount - 1n);
    if (isListType(type)) {
      currentIndex = currentIndex * 2n;
      pathIndexDelta += 1;
      if (currentIndex + 1n === index) {
        return [[...currentPath, "__len__"]];
      }
    }
    currentIndex *= fullChunkCount;
    const prevPathIndex = pathIndices.indexOf(prevIndex);
    const currentPathIndex = pathIndices[prevPathIndex - pathIndexDelta];
    const maxIndex = currentIndex + BigInt(getItemPosition(type, maxLength(type as ArrayType))[0]);
    if (maxIndex < currentPathIndex) {
      throw new Error("no valid paths");
    }
    const firstMatchedIndex = Number(currentPathIndex - currentIndex);
    const elementType = getElementType(type, firstMatchedIndex);
    const elementItemLength = itemLength(elementType);
    if (isBasicType(elementType)) {
      return Array.from({length: Math.floor(32 / elementItemLength)}, (_, i) => firstMatchedIndex + i)
        .map((i) => ([...currentPath, i]));
    } else {
      const elementIndex = currentIndex + BigInt(getItemPosition(type, firstMatchedIndex)[0]);
      const path = [...currentPath, firstMatchedIndex];
      if (elementIndex === index) {
        return [path];
      }
      return _getPaths(elementType, index, pathIndices, elementIndex, path);
    }
  }
}
