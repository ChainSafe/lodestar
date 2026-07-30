import type {RootHex} from "@lodestar/types";

const ROOT_HEX_PATTERN = /^0x[0-9a-f]{64}$/;

export function isValidRootHex(rootHex: string): rootHex is RootHex {
  return ROOT_HEX_PATTERN.test(rootHex);
}

export function assertValidRootHex(rootHex: string): asserts rootHex is RootHex {
  if (!isValidRootHex(rootHex)) {
    throw new Error(`Invalid flat file root: ${rootHex}`);
  }
}

/**
 * Zero-pad a slot number to 12 digits for lexicographic ordering in directory names.
 * Twelve digits covers many centuries of Ethereum; larger safe integers remain untruncated.
 */
export function padSlot(slot: number): string {
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new Error(`Invalid flat file slot: ${slot}`);
  }

  return String(slot).padStart(12, "0");
}
