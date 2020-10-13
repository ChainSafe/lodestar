import {Root} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

export function isEqualRoot(root1: Root, root2: Root): boolean {
  return toHexString(root1) === toHexString(root2);
}

/**
 * Typesafe wrapper around `String()`. The String constructor accepts any which is dangerous
 * @param num
 */
export function numToString(num: number): string {
  return String(num);
}
