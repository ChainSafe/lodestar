import {
  FullSSZType,
  Type,
} from "@chainsafe/ssz-type-schema";

import {chunkCount} from "../../util/chunk";
import {bitLength} from "../../util/math";

export function treeHeight(type: FullSSZType): number {
  const chunkHeight = bitLength(chunkCount(type) - 1);
  switch (type.type) {
    case Type.uint:
    case Type.bool:
    case Type.bitList:
    case Type.bitVector:
    case Type.byteList:
    case Type.byteVector:
      return chunkHeight;
    case Type.list:
    case Type.vector:
      return chunkHeight + treeHeight(type.elementType);
    case Type.container:
      return chunkHeight + Math.max(
        ...type.fields.map(([_, fieldType]) => treeHeight(fieldType))
      );
  }
}
