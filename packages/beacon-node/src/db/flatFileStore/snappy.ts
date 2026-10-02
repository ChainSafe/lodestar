import {compressSync, uncompressSync} from "snappy";

// Copy outputs to avoid deferring native allocation release until the event loop runs finalizers.
export function compress(data: Uint8Array): Uint8Array {
  return compressSync(toBuffer(data), {copyOutputData: true});
}

export function uncompress(data: Uint8Array): Uint8Array {
  const result = uncompressSync(toBuffer(data), {asBuffer: true, copyOutputData: true}) as Buffer;
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}

function toBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}
