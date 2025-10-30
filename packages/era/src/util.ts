import {Uint8ArrayList} from "uint8arraylist";
import {SnappyFramesUncompress, encodeSnappy} from "@lodestar/reqresp/encodingStrategies/sszSnappy";

/** Read 48-bit signed integer (little-endian) at offset. */
export function readInt48(bytes: Uint8Array, offset: number): number {
  return Buffer.prototype.readIntLE.call(bytes, offset, 6);
}

/** Read 48-bit signed integer (little-endian) at offset. */
export function readUint48(bytes: Uint8Array, offset: number): number {
  return Buffer.prototype.readUintLE.call(bytes, offset, 6);
}

/** Write 48-bit signed integer (little-endian) into target at offset. */
export function writeInt48(target: Uint8Array, offset: number, v: number): void {
  Buffer.prototype.writeIntLE.call(target, v, offset, 6);
}

/** Decompress snappy-framed data  */
export function snappyUncompress(compressedData: Uint8Array): Uint8Array {
  const decompressor = new SnappyFramesUncompress();

  const input = new Uint8ArrayList(compressedData);
  const result = decompressor.uncompress(input);

  if (result === null) {
    throw new Error("Snappy decompression failed - no data returned");
  }

  return result.subarray();
}

/** Compress data using snappy framing */
export async function snappyCompress(data: Uint8Array): Promise<Uint8Array> {
  const buffers: Buffer[] = [];
  for await (const chunk of encodeSnappy(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) {
    buffers.push(chunk);
  }
  const total = buffers.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of buffers) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
