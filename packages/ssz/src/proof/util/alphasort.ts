import {GeneralizedIndex} from "./types";
import {bitLength} from "../../util/bigintMath";
import {bit} from "./generalizedIndex";

export function splitByRoot(
  indices: GeneralizedIndex[] | Set<GeneralizedIndex>,
  depth: number
): [GeneralizedIndex[], GeneralizedIndex[], GeneralizedIndex[]] {
  const t = [];
  const l = [];
  const r = [];
  for (const index of indices) {
    const iDepth = bitLength(index);
    if (iDepth < depth) {
      t.push(index);
    } else if (bit(index, iDepth - depth)) {
      r.push(index);
    } else {
      l.push(index);
    }
  }
  return [t, l, r];
}

export function alphasort(indices: GeneralizedIndex[] | Set<GeneralizedIndex>, depth: number = 2): GeneralizedIndex[] {
  if (Array.isArray(indices)) {
    if (indices.length <= 1) {
      return indices;
    }
  } else if (indices.size <= 1) {
    return Array.from(indices.values());
  }
  const [t, l, r] = splitByRoot(indices, depth);
  alphasort(l, depth + 1).forEach((index) => t.push(index));
  alphasort(r, depth + 1).forEach((index) => t.push(index));
  return t;
}
