import {Root} from "@lodestar/types";
import {toHex} from "@lodestar/utils";

/**
 * Return items included in `next` but not in `prev`
 */
export function differenceHex<T extends Uint8Array | Root>(prev: T[], next: T[]): T[] {
  const existing = new Set(prev.map((item) => toHex(item)));
  return next.filter((item) => !existing.has(toHex(item)));
}
