import {intToBytes} from "@lodestar/utils";
import {BUCKET_LENGTH} from "./const.js";

export const uintLen = 8;

/**
 * Prepend a bucket to a key
 */
export function encodeKey(bucket: number, key: Uint8Array | string | number | bigint): Uint8Array {
  let buf: Buffer;
  const prefixLength = BUCKET_LENGTH;
  //all keys are writen with prefixLength offet
  if (typeof key === "string") {
    buf = Buffer.alloc(key.length + prefixLength);
    buf.write(key, prefixLength);
  } else if (typeof key === "number" || typeof key === "bigint") {
    buf = Buffer.alloc(uintLen + prefixLength);
    intToBytes(BigInt(key), uintLen, "be").copy(buf, prefixLength);
  } else {
    buf = Buffer.alloc(key.length + prefixLength);
    buf.set(key, prefixLength);
  }
  //bucket prefix on position 0
  buf.set(intToBytes(bucket, BUCKET_LENGTH, "le"), 0);
  return buf;
}
