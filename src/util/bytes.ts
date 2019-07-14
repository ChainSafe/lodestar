/**
 * @module util/bytes
 */

import BN from "bn.js";

import {bytes} from "../types";
import {PrivateKey} from '@chainsafe/bls-js/lib/privateKey';

/**
 * Return a byte array from a number or BN
 */
export function intToBytes(value: BN | number, length: number, endianess?: "le"| "be"): bytes {
  let endianType: "le"| "be" = "le";
  if(endianess){
    endianType = endianess;
  }

  if (BN.isBN(value)) { // value is BN
    return value.toArrayLike(Buffer, endianType, length);
  } else if (length <= 6) { // value is a number and length is at most 6 bytes
    const b = Buffer.alloc(length);
    if(endianType == "be") {
      b.writeUIntBE(value, 0, length);
    } else {
      b.writeUIntLE(value, 0, length);
    }
    return b;
  } else { // value is number and length is too large for Buffer#writeUIntLE
    value = new BN(value);

    return value.toArrayLike(Buffer, endianType, length);
  }
}

export function bytesToBN(value: bytes, endianess?: "le"| "be"): BN {
  let endianType: "le"| "be" = "le";
  if(endianess){
    endianType = endianess;
  }
  return new BN(value, endianType);
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

  return "0x".concat(pkBytes.toString('hex'));
}
