import {Epoch, Root, ssz} from "@lodestar/types";
import {fromHex, toHex, toRootHex} from "@lodestar/utils";

export const blsPubkeyLen = 48;
export const ZERO_ROOT = ssz.Root.defaultValue();

export function isEqualRoot(root1: Root, root2: Root): boolean {
  return ssz.Root.equals(root1, root2);
}

export function isEqualNonZeroRoot(root1: Root, root2: Root): boolean {
  return !isEqualRoot(root1, ZERO_ROOT) && isEqualRoot(root1, root2);
}

export function fromOptionalHexString(hex: string | undefined): Root {
  return hex ? fromHex(hex) : ZERO_ROOT;
}

export function toOptionalHexString(root: Root): string | undefined {
  return isEqualRoot(root, ZERO_ROOT) ? undefined : toRootHex(root);
}

/**
 * Typesafe wrapper around `String()`. The String constructor accepts any which is dangerous
 */
export function numToString(num: number): string {
  return String(num);
}

export function minEpoch(epochs: Epoch[]): Epoch | null {
  return epochs.length > 0 ? epochs.reduce((minEpoch, epoch) => (minEpoch < epoch ? minEpoch : epoch)) : null;
}

export function uniqueVectorArr(buffers: Uint8Array[]): Uint8Array[] {
  const bufferStr = new Set<string>();
  return buffers.filter((buffer) => {
    const str = toHex(buffer);
    const seen = bufferStr.has(str);
    bufferStr.add(str);
    return !seen;
  });
}
