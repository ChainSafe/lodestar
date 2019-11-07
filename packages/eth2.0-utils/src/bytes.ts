import {bytes} from "@chainsafe/eth2.0-types";
import {toBufferLE, toBigIntLE} from "bigint-buffer";
/**
 * Return a byte array from a number or BN
 */
export function intToBytes(value: bigint | number, length: number): bytes {
  if (typeof  value === "number" && length <= 6) { // value is a number and length is at most 6 bytes
    const b = Buffer.alloc(length);
    b.writeUIntLE(value, 0, length);
    return b;
  } else { // value is number and is too large, or a BigInt
    value = BigInt(value);
    return toBufferLE(value, length);
  }
}

export function bytesToBN(value: bytes): bigint {
  return toBigIntLE(value);
}


export function toHex(buffer: Buffer): string {
  return "0x" + buffer.toString("hex");
}