import {SnappyCompressor} from "./compressor.js";
import {SnappyDecompressor} from "./decompressor.js";
import {SnappyError, SnappyErrorCode} from "./error.js";

function isNode(): boolean {
  if (
    typeof process === "object" &&
    typeof process.versions === "object" &&
    typeof process.versions.node !== "undefined"
  ) {
    return true;
  }
  return false;
}

function isUint8Array(object: Uint8Array | Buffer): object is Uint8Array {
  return object instanceof Uint8Array && (!isNode() || !Buffer.isBuffer(object));
}

export function uncompress<T extends Buffer | Uint8Array>(compressed: T, maxLength: number, outBuf?: Uint8Array): T {
  const decompressor = new SnappyDecompressor(compressed);
  const length = decompressor.readUncompressedLength();
  if (length === -1) {
    throw new SnappyError({code: SnappyErrorCode.UNCOMPRESS_CANNOT_EXTRACT_LENGTH});
  }
  if (maxLength !== undefined && length > maxLength) {
    throw new SnappyError({code: SnappyErrorCode.UNCOMPRESS_EXCEED_MAX_LENGTH});
  }
  if (outBuf !== undefined && outBuf.length < length) {
    throw new SnappyError({code: SnappyErrorCode.UNCOMPRESS_BUFFER_TOO_SMALL});
  }

  const uncompressed =
    outBuf !== undefined
      ? outBuf.subarray(0, length)
      : isUint8Array(compressed)
        ? new Uint8Array(length)
        : Buffer.allocUnsafe(length);

  if (!decompressor.uncompressInto(uncompressed)) {
    throw new SnappyError({code: SnappyErrorCode.UNCOMPRESS_INVALID_BITSTREAM});
  }
  return uncompressed as T;
}

export function compress<T extends Buffer | Uint8Array>(uncompressed: T): T {
  const compressor = new SnappyCompressor(uncompressed);
  const maxLength = compressor.maxCompressedLength();
  const uint8Mode = isUint8Array(uncompressed);
  const compressed = uint8Mode ? new Uint8Array(maxLength) : Buffer.allocUnsafe(maxLength);
  const length = compressor.compressToBuffer(compressed);
  if (uint8Mode) {
    return compressed.subarray(0, length) as T;
  }
  return compressed.slice(0, length) as T;
}
