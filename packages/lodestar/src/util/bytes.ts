/**
 * @module util/bytes
 */

import {bytes} from "@chainsafe/eth2.0-types";
import {PrivateKey} from "@chainsafe/bls/lib/privateKey";
import {toBufferLE, toBigIntLE} from "bigint-buffer";

/**
 * Return a byte array from a number or BN
 */
export function intToBytes(value: number | bigint, length: number): bytes {
  if (length <= 6 && typeof value === "number") { // value is a number and length is at most 6 bytes
    const b = Buffer.alloc(length);
    b.writeUIntLE(value, 0, length);
    return b;
  } else { // value is number and length is too large for Buffer#writeUIntLE
    value = BigInt(value);
    return toBufferLE(value, length);
  }
}

export function bytesToBigInt(value: bytes): bigint{
  return toBigIntLE(value);
}

/**
 * Converts PrivateKey to hex string
 * @param {PrivateKey} privateKey 
 * @returns {string} hex representation of bls key
 */
export function blsPrivateKeyToHex(privateKey: PrivateKey): string {
  const byteBuffer = Buffer.alloc(48, 0);
  privateKey.getValue().tobytearray(byteBuffer, 0);
  const pkBytes = byteBuffer.slice(16, 48);

  return toHex(pkBytes);
}

export function toHex(buffer: Buffer): string {
  return "0x" + buffer.toString("hex");
}