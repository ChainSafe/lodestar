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
  // Buffer api only support up to 6 bytes
  // otherwise got "RangeError [ERR_OUT_OF_RANGE]: The value of "value" is out of range. It must be >= 0 and < 2 ** 48"
  // always use vanilla version to see if it's an issue
  // if (typeof value === "number" && value < Math.pow(2, 48)) {
  //   const buffer = Buffer.alloc(length);
  //   if (endianness === "le") {
  //     // writeUintLE only supports 1 to 6 byteLength
  //     buffer.writeUintLE(value, 0, Math.min(length, 6));
  //   } else {
  //     // writeUintBE only supports 1 to 6 byteLength
  //     const bytesLength = Math.min(length, 6);
  //     const offset = Math.max(0, length - bytesLength);
  //     buffer.writeUintBE(value, offset, Math.min(length, 6));
  //   }
  //   return buffer;
  // }

  return intToBytesVanilla(value, length, endianness);
}

/**
 * Same function to intToBytes but we compute ourself if possible to avoid using BigInt.
 * See https://github.com/ChainSafe/lodestar/issues/5892
 * Do not use this function directly, it's separated for testing only
 */
export function intToBytesVanilla(value: bigint | number, length: number, endianness: Endianness = "le"): Buffer {
  if (typeof value === "number" && (length === 2 || length === 4 || length === 8)) {
    // compute ourself if possible
    const result = Buffer.alloc(length);
    const dataView = new DataView(result.buffer, result.byteOffset, result.byteLength);
    if (length === 2) {
      dataView.setUint16(0, value, endianness === "le");
    } else if (length === 4) {
      dataView.setUint32(0, value, endianness === "le");
    } else {
      // length === 8
      const leastSignificant = (value & 0xffffffff) >>> 0;
      const mostSignificant = value > 0xffffffff ? Math.floor((value - leastSignificant) / 0xffffffff) : 0;
      if (endianness === "le") {
        dataView.setUint32(0, leastSignificant, true);
        dataView.setUint32(4, mostSignificant, true);
      } else {
        dataView.setUint32(0, mostSignificant, false);
        dataView.setUint32(4, leastSignificant, false);
      }
    }
    return result;
  }

  // only fallback to bigIntToBytes to avoid having to use BigInt if possible
  return bigIntToBytes(BigInt(value), length, endianness);
}

/**
 * Convert byte array in LE to integer.
 */
export function bytesToInt(value: Uint8Array, endianness: Endianness = "le"): number {
  // use Buffer api if possible since it's the fastest
  // it only supports up to 6 bytes through
  if (endianness === "le") {
    const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value.length <= 8 && value[6] === 0 && value[7] === 0) {
      return buffer.readUintLE(0, Math.min(value.length, 6));
    }
  } else {
    const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value.length <= 8 && value[0] === 0 && value[1] === 0) {
      const bytesLength = Math.min(value.length, 6);
      const offset = Math.max(0, length - bytesLength);
      return buffer.readUintBE(offset, bytesLength);
    }
  }

  // otherwise compute manually
  let result = 0;
  if (endianness === "le") {
    for (let i = 0; i < value.length; i++) {
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
