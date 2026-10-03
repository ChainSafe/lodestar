import {Epoch, Root, ssz} from "@lodestar/types";
import {fromHex, toHex, toRootHex} from "@lodestar/utils";
import {InterchangeError, InterchangeErrorErrorCode} from "./interchange/errors.js";

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

/**
 * Parse a decimal uint string, rejecting values the slashing protection DB range scans cannot see
 */
export function stringToNum(str: string): number {
  const num = Number(str);
  if (!/^[0-9]+$/.test(str) || num >= Number.MAX_SAFE_INTEGER) {
    throw new InterchangeError({code: InterchangeErrorErrorCode.INVALID_VALUE, value: str});
  }
  return num;
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
