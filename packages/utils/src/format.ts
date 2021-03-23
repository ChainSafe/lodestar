import {ByteVector, toHexString} from "@chainsafe/ssz";

/**
 * Format bytes as `0x1234…1234`
 */
export function prettyBytes(root: Uint8Array | ByteVector): string {
  const str = toHexString(root);
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}
