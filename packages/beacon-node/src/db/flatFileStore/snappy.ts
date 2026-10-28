import {compressSync, uncompressSync} from "snappy";
import {DataColumnStoreError, DataColumnStoreErrorCode} from "./errors.js";

export function compress(data: Uint8Array): Uint8Array {
  return compressSync(toBuffer(data));
}

export function uncompress(data: Uint8Array, maxBytes?: number): Uint8Array {
  if (maxBytes !== undefined) {
    let length = 0;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      length += (data[i] & 0x7f) * 2 ** (7 * i);
      if (length > maxBytes) {
        throw new DataColumnStoreError({
          code: DataColumnStoreErrorCode.READ_LIMIT_EXCEEDED,
          bytes: length,
          limit: maxBytes,
        });
      }
      if ((data[i] & 0x80) === 0) break;
    }
  }
  const result = uncompressSync(toBuffer(data), {asBuffer: true}) as Buffer;
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}

function toBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}
