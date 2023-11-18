import {toBufferLE, toBigIntLE, toBufferBE, toBigIntBE} from "bigint-buffer";

type Endianness = "le" | "be";

const hexByByte: string[] = [];
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
  if (typeof value === "number") {
    // this is to avoid using BigInt
    if (length === 2 || length === 4) {
      const result = Buffer.alloc(length);
      const dataView = new DataView(result.buffer, result.byteOffset, result.byteLength);
      if (length === 2) {
        dataView.setUint16(0, value, endianness === "le");
      } else {
        dataView.setUint32(0, value, endianness === "le");
      }
      return result;
    } else if (length === 8) {
      const result = Buffer.alloc(8);
      const dataView = new DataView(result.buffer, result.byteOffset, result.byteLength);
      const leastSignificant = (value & 0xffffffff) >>> 0;
      const mostSignificant = value > 0xffffffff ? Math.floor((value - leastSignificant) / 0xffffffff) : 0;
      if (endianness === "le") {
        dataView.setUint32(0, leastSignificant, true);
        dataView.setUint32(4, mostSignificant, true);
      } else {
        dataView.setUint32(0, mostSignificant, false);
        dataView.setUint32(4, leastSignificant, false);
      }
      return result;
    }
  }
  return bigIntToBytes(BigInt(value), length, endianness);
}

/**
 * Convert byte array in LE to integer.
 */
export function bytesToInt(value: Uint8Array, endianness: Endianness = "le"): number {
  let result = 0;
  if (endianness === "le") {
    for (let i = 0; i < value.length; i++) {
      // result += (value[i] << (8 * i)) >>> 0;
      result += value[i] * Math.pow(2, 8 * i);
    }
  } else {
    for (let i = 0; i < value.length; i++) {
      result += (value[i] << (8 * (value.length - 1 - i))) >>> 0;
    }
  }

  return result;
}

export function bigIntToBytes(value: bigint, length: number, endianness: Endianness = "le"): Buffer {
  if (endianness === "le") {
    return toBufferLE(value, length);
  } else if (endianness === "be") {
    return toBufferBE(value, length);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function bytesToBigInt(value: Uint8Array, endianness: Endianness = "le"): bigint {
  if (endianness === "le") {
    return toBigIntLE(value as Buffer);
  } else if (endianness === "be") {
    return toBigIntBE(value as Buffer);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

/**
 * Compare two byte arrays in LE.
 * Instead of calling `a < b`, use `compareBytesLe(a, b) < 0`.
 */
export function compareBytesLe(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error(`Lengths must be equal: ${a.length} !== ${b.length}`);
  }
  // Cannot use Buffer.compare() since this is LE
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

export function toHex(buffer: Uint8Array | Parameters<typeof Buffer.from>[0]): string {
  if (Buffer.isBuffer(buffer)) {
    return "0x" + buffer.toString("hex");
  } else if (buffer instanceof Uint8Array) {
    return "0x" + Buffer.from(buffer.buffer, buffer.byteOffset, buffer.length).toString("hex");
  } else {
    return "0x" + Buffer.from(buffer).toString("hex");
  }
}

export function fromHex(hex: string): Uint8Array {
  const b = Buffer.from(hex.replace("0x", ""), "hex");
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
