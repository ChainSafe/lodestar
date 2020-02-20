import {toBufferLE, toBigIntLE} from "bigint-buffer";
/**
 * Return a byte array from a number or BigInt
 */
export function intToBytes(value: bigint | number, length: number): Buffer {
  if (typeof  value === "number" && length <= 6) { // value is a number and length is at most 6 bytes
    const b = Buffer.alloc(length);
    b.writeUIntLE(value, 0, length);
    return b;
  } else { // value is number and is too large, or a BigInt
    value = BigInt(value);
    return toBufferLE(value, length);
  }
}

/**
 * Convert byte array in LE to integer.
 */
export function bytesToInt(value: Uint8Array): number {
  const length = value.length;
  let result = 0;
  for (let i = 0; i < length; i++) {
    result += value[i] * 2 ** (8 * i);
  }
  return result;
}

export function bytesToBigInt(value: Uint8Array): bigint {
  return toBigIntLE(value as Buffer);
}

export function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const b = toBufferLE(value, length);
  return new Uint8Array(b.buffer, b.byteOffset, length);
}


export function toHex(buffer: Uint8Array): string {
  return "0x" + Buffer.from(buffer.buffer, buffer.byteOffset).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  const b = Buffer.from(hex.replace("0x", ""), "hex");
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
