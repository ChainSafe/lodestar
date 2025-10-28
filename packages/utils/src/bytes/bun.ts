import {bytes} from "@lodestar/bun";

export function toHex(data: Uint8Array): string {
  return `0x${data.toHex()}`;
}

export function toRootHex(root: Uint8Array): string {
  if (root.length !== 32) {
    throw Error(`Expect root to be 32 bytes, got ${root.length}`);
  }
  return `0x${root.toHex()}`;
}

export function toPubkeyHex(pubkey: Uint8Array): string {
  if (pubkey.length !== 48) {
    throw Error(`Expect pubkey to be 48 bytes, got ${pubkey.length}`);
  }
  return `0x${pubkey.toHex()}`;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }

  if (hex.length % 2 !== 0) {
    throw new Error(`hex string length ${hex.length} must be multiple of 2`);
  }

  return Uint8Array.fromHex(hex);
}

export function fromHexInto(hex: string, buffer: Uint8Array): void {
  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }

  if (hex.length !== buffer.length * 2) {
    throw new Error(`hex string length ${hex.length} must be exactly double the buffer length ${buffer.length}`);
  }

  buffer.setFromHex(hex);
}

export const toHexString = toHex;

import {bytesToBigInt as bBytesToBigInt, bytesToInt as bBytesToInt, intToBytes as bIntToBytes} from "./browser.ts";

export function intToBytes(value: number | bigint, byteLength: number, endianness: "be" | "le" = "le"): Uint8Array {
  if (byteLength > 8) {
    return bIntToBytes(value, byteLength, endianness);
  }
  return bytes.intToBytes(value, byteLength, endianness);
}

export function bytesToInt(buf: Uint8Array, endianness: "be" | "le" = "le"): number {
  if (buf.length > 8) {
    return bBytesToInt(buf, endianness);
  }
  return bytes.bytesToInt(buf, endianness);
}

export const bigIntToBytes = intToBytes;

export function bytesToBigInt(buf: Uint8Array, endianness: "be" | "le" = "le"): bigint {
  if (buf.length > 8) {
    return bBytesToBigInt(buf, endianness);
  }
  return bytes.bytesToBigint(buf, endianness);
}

export {xor} from "./browser.ts";
