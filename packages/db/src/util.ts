import {bytesToInt, intToBytes} from "@lodestar/utils";
import {BUCKET_LENGTH} from "./const.js";

export const uintLen = 8;

/**
 * Encode a key for the db write/read, Prepend a bucket to a key
 *
 * The encoding of key is very important step that can cause failure of proper indexing and querying of data
 *
 * We are using LevelDB which have pluggable comparator support, so you can decide how to
 * compare keys. But for NodeJS binding only default comparison algorithm is supported which
 * uses lexicographical comparison of the raw bytes of the keys
 *
 * It is important to use **helpers implemented here** to encode db keys so that key comparison properly work.
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

export function encodeNumberForDbKey(value: number, byteSize: number): Uint8Array {
  return intToBytes(value, byteSize, "be");
}

export function decodeNumberForDbKey(value: Uint8Array, byteSize: number): number {
  return bytesToInt(value.slice(0, byteSize), "be");
}

export function encodeStringForDbKey(value: string): Uint8Array {
  return Buffer.from(value, "utf-8");
}

export function decodeStringForDbKey(value: Uint8Array): string {
  return Buffer.from(value).toString("utf8");
}
