import {Root} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

/**
 * Return items included in `next` but not in `prev`
 */
export function differenceHex<T extends Uint8Array | Root>(prev: T[], next: T[]): T[] {
  const existing = new Set(prev.map((item) => toHexString(item)));
  return next.filter((item) => !existing.has(toHexString(item)));
}
