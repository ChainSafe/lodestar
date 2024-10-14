import {toBufferLE, toBigIntLE, toBufferBE, toBigIntBE} from "bigint-buffer";

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
export function intToBytes(value: bigint | number, length: number, endianness: Endianness = "le"): Buffer {
  return bigIntToBytes(BigInt(value), length, endianness);
}

/**
 * Convert byte array in LE to integer.
 */
export function bytesToInt(value: Uint8Array, endianness: Endianness = "le"): number {
  return Number(bytesToBigInt(value, endianness));
}

export function bigIntToBytes(value: bigint, length: number, endianness: Endianness = "le"): Buffer {
  if (endianness === "le") {
    return toBufferLE(value, length);
  }
  if (endianness === "be") {
    return toBufferBE(value, length);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function bytesToBigInt(value: Uint8Array, endianness: Endianness = "le"): bigint {
  if (endianness === "le") {
    return toBigIntLE(value as Buffer);
  }
  if (endianness === "be") {
    return toBigIntBE(value as Buffer);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function formatBytes(bytes: number): string {
  if (bytes < 0) {
    throw new Error("bytes must be a positive number, got " + bytes);
  }

  if (bytes === 0) {
    return "0 Bytes";
  }

  // size of a kb
  const k = 1024;

  // only support up to GB
  const units = ["Bytes", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const formattedSize = (bytes / Math.pow(k, i)).toFixed(2);

  return `${formattedSize} ${units[i]}`;
}
