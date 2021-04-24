import {ByteVector, toHexString} from "@chainsafe/ssz";

/**
 * Format bytes as `0x1234…1234`
 * 4 bytes can represent 4294967296 values, so the chance of collision is low
 */
export function prettyBytes(root: Uint8Array | ByteVector | string): string {
  const str = typeof root === "string" ? root : toHexString(root);
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}
