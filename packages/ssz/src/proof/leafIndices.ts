import {
  SerializableValue,
  FullSSZType,
} from "@chainsafe/ssz-type-schema";

import {GeneralizedIndex} from "./util/types";
import {getGeneralizedIndices} from "./util/typeToIndex";
import {leafPaths} from "./leafPaths";

/**
 * Return all leaf indices for a value,
 * sorted bit-alphabetic left-to-right
 */
export function leafIndices(value: SerializableValue, type: FullSSZType): GeneralizedIndex[] {
  return getGeneralizedIndices(type, leafPaths(value, type));
}
