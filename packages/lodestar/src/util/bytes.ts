/**
 * @module util/bytes
 */

import BN from "bn.js";

import {bytes} from "@chainsafe/eth2.0-types";

/**
 * Return a byte array from a number or BN
 */
export function intToBytes(value: BN | number, length: number): bytes {
  if (BN.isBN(value)) { // value is BN
    return value.toArrayLike(Buffer, "le", length);
  } else if (length <= 6) { // value is a number and length is at most 6 bytes
    const b = Buffer.alloc(length);
    b.writeUIntLE(value, 0, length);
    return b;
  } else { // value is number and length is too large for Buffer#writeUIntLE
    value = new BN(value);
    return value.toArrayLike(Buffer, "le", length);
  }
}
