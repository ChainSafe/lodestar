// "0".charCodeAt(0) = 48
const CHAR_CODE_0 = 48;
// "x".charCodeAt(0) = 120
const CHAR_CODE_X = 120;

export function toHex(bytes: Uint8Array): string {
  const charCodes = new Array<number>(bytes.length * 2 + 2);
  charCodes[0] = CHAR_CODE_0;
  charCodes[1] = CHAR_CODE_X;

  bytesIntoCharCodes(bytes, charCodes);
  return String.fromCharCode(...charCodes);
}

const rootCharCodes = new Array<number>(32 * 2 + 2);
rootCharCodes[0] = CHAR_CODE_0;
rootCharCodes[1] = CHAR_CODE_X;

/**
 * Convert a Uint8Array, length 32, to 0x-prefixed hex string
 */
export function toRootHex(root: Uint8Array): string {
  if (root.length !== 32) {
    throw Error(`Expect root to be 32 bytes, got ${root.length}`);
  }

  bytesIntoCharCodes(root, rootCharCodes);
  return String.fromCharCode(...rootCharCodes);
}

const pubkeyCharCodes = new Array<number>(48 * 2 + 2);
pubkeyCharCodes[0] = CHAR_CODE_0;
pubkeyCharCodes[1] = CHAR_CODE_X;

/**
 * Convert a Uint8Array, length 48, to 0x-prefixed hex string
 */
export function toPubkeyHex(pubkey: Uint8Array): string {
  if (pubkey.length !== CHAR_CODE_0) {
    throw Error(`Expect pubkey to be 48 bytes, got ${pubkey.length}`);
  }

  bytesIntoCharCodes(pubkey, pubkeyCharCodes);
  return String.fromCharCode(...pubkeyCharCodes);
}

export function fromHex(hex: string): Uint8Array {
  if (typeof hex !== "string") {
    throw new Error(`hex argument type ${typeof hex} must be of type string`);
  }

  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }

  if (hex.length % 2 !== 0) {
    throw new Error(`hex string length ${hex.length} must be multiple of 2`);
  }

  const byteLen = hex.length / 2;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    const byte2i = charCodeToByte(hex.charCodeAt(i * 2));
    const byte2i1 = charCodeToByte(hex.charCodeAt(i * 2 + 1));
    bytes[i] = (byte2i << 4) | byte2i1;
  }
  return bytes;
}

export function fromHexInto(hex: string, buffer: Uint8Array): void {
  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }

  if (hex.length !== buffer.length * 2) {
    throw new Error(`hex string length ${hex.length} must be exactly double the buffer length ${buffer.length}`);
  }

  for (let i = 0; i < buffer.length; i++) {
    const byte2i = charCodeToByte(hex.charCodeAt(i * 2));
    const byte2i1 = charCodeToByte(hex.charCodeAt(i * 2 + 1));
    buffer[i] = (byte2i << 4) | byte2i1;
  }
}

/**
 * Populate charCodes from bytes. Note that charCodes index 0 and 1 ("0x") are not populated.
 */
function bytesIntoCharCodes(bytes: Uint8Array, charCodes: number[]): void {
  if (bytes.length * 2 + 2 !== charCodes.length) {
    throw Error(`Expect charCodes to be of length ${bytes.length * 2 + 2}, got ${charCodes.length}`);
  }

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    const first = (byte & 0xf0) >> 4;
    const second = byte & 0x0f;

    // "0".charCodeAt(0) = 48
    // "a".charCodeAt(0) = 97 => delta = 87
    charCodes[2 + 2 * i] = first < 10 ? first + 48 : first + 87;
    charCodes[2 + 2 * i + 1] = second < 10 ? second + 48 : second + 87;
  }
}

function charCodeToByte(charCode: number): number {
  // "a".charCodeAt(0) = 97, "f".charCodeAt(0) = 102 => delta = 87
  if (charCode >= 97 && charCode <= 102) {
    return charCode - 87;
  }

  // "A".charCodeAt(0) = 65, "F".charCodeAt(0) = 70 => delta = 55
  if (charCode >= 65 && charCode <= 70) {
    return charCode - 55;
  }

  // "0".charCodeAt(0) = 48, "9".charCodeAt(0) = 57 => delta = 48
  if (charCode >= 48 && charCode <= 57) {
    return charCode - 48;
  }

  throw new Error(`Invalid hex character code: ${charCode}`);
}

import {toBigIntBE, toBigIntLE, toBufferBE, toBufferLE} from "bigint-buffer";

type Endianness = "le" | "be";

const hexByByte: string[] = [];
/**
 * @deprecated Use toHex() instead.
 */
export function toHexString(bytes: Uint8Array): string {
  let hex = "0x";
  for (const byte of bytes) {
    if (!hexByByte[byte]) {
      hexByByte[byte] = byte < 16 ? "0" + byte.toString(16) : byte.toString(16);
    }
    hex += hexByByte[byte];
  }
  return hex;
}

/**
 * Return a byte array from a number or BigInt
 */
export function intToBytes(value: bigint | number, length: number, endianness: Endianness = "le"): Uint8Array {
  return bigIntToBytes(BigInt(value), length, endianness);
}

/**
 * Convert byte array in LE to integer.
 */
export function bytesToInt(value: Uint8Array, endianness: Endianness = "le"): number {
  return Number(bytesToBigInt(value, endianness));
}

export function bigIntToBytes(value: bigint, length: number, endianness: Endianness = "le"): Uint8Array {
  if (endianness === "le") {
    return toBufferLE(value, length);
  }
  if (endianness === "be") {
    return toBufferBE(value, length);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function bytesToBigInt(value: Uint8Array, endianness: Endianness = "le"): bigint {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("expected a Uint8Array");
  }

  if (endianness === "le") {
    return toBigIntLE(value as Buffer);
  }
  if (endianness === "be") {
    return toBigIntBE(value as Buffer);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    a[i] = a[i] ^ b[i];
  }
  return a;
}
