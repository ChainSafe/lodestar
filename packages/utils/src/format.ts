import {toHexString} from "./bytes.js";

/**
 * Format bytes as `0x1234…1234`
 * 4 bytes can represent 4294967296 values, so the chance of collision is low
 */
export function prettyBytes(root: Uint8Array | string): string {
  const str = typeof root === "string" ? root : toHexString(root);
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

/**
 * Format bytes as `0x1234…`
 * Paired with block numbers or slots, it can still act as a decent identify-able format
 */
export function prettyBytesShort(root: Uint8Array | string): string {
  const str = typeof root === "string" ? root : toHexString(root);
  return `${str.slice(0, 6)}…`;
}
