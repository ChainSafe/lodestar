import {SnappyCompressor} from "./compressor.js";
import {SnappyDecompressor} from "./decompressor.js";

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

function isUint8Array(object: Uint8Array | ArrayBuffer | Buffer): object is Uint8Array {
  return object instanceof Uint8Array && (!isNode() || !Buffer.isBuffer(object));
}

function isArrayBuffer(object: Uint8Array | ArrayBuffer | Buffer): object is ArrayBuffer {
  return object instanceof ArrayBuffer;
}

function isBuffer(object: Uint8Array | ArrayBuffer | Buffer): object is Buffer {
  if (!isNode()) {
    return false;
  }
  return Buffer.isBuffer(object);
}

const TYPE_ERROR_MSG = "Argument compressed must be type of ArrayBuffer, Buffer, or Uint8Array";

export function uncompress<T extends ArrayBuffer | Buffer | Uint8Array>(compressed: T, maxLength?: number): T {
  if (!isUint8Array(compressed) && !isArrayBuffer(compressed) && !isBuffer(compressed)) {
    throw new TypeError(TYPE_ERROR_MSG);
  }
  let uint8Mode = false;
  let arrayBufferMode = false;
  let compressedView: Uint8Array;
  if (isUint8Array(compressed)) {
    uint8Mode = true;
    compressedView = compressed;
  } else if (isArrayBuffer(compressed)) {
    arrayBufferMode = true;
    compressedView = new Uint8Array(compressed);
  } else {
    compressedView = compressed;
  }

  const decompressor = new SnappyDecompressor(compressedView);
  const length = decompressor.readUncompressedLength();
  if (length === -1) {
    throw new Error("Invalid Snappy bitstream");
  }
  if (maxLength !== undefined && length > maxLength) {
    throw new Error(`The uncompressed length of ${length} is too big, expect at most ${maxLength}`);
  }

  let uncompressed: ArrayBuffer | Buffer | Uint8Array;
  if (uint8Mode) {
    uncompressed = new Uint8Array(length);
    if (!decompressor.uncompressToBuffer(uncompressed)) {
      throw new Error("Invalid Snappy bitstream");
    }
  } else if (arrayBufferMode) {
    uncompressed = new ArrayBuffer(length);
    const uncompressedView = new Uint8Array(uncompressed);
    if (!decompressor.uncompressToBuffer(uncompressedView)) {
      throw new Error("Invalid Snappy bitstream");
    }
  } else {
    uncompressed = Buffer.allocUnsafe(length);
    if (!decompressor.uncompressToBuffer(uncompressed)) {
      throw new Error("Invalid Snappy bitstream");
    }
  }
  return uncompressed as T;
}

export function compress<T extends ArrayBuffer | Buffer | Uint8Array>(uncompressed: T): T {
  if (!isUint8Array(uncompressed) && !isArrayBuffer(uncompressed) && !isBuffer(uncompressed)) {
    throw new TypeError(TYPE_ERROR_MSG);
  }
  let uint8Mode = false;
  let arrayBufferMode = false;
  let uncompressedView: Uint8Array;
  if (isUint8Array(uncompressed)) {
    uint8Mode = true;
    uncompressedView = uncompressed;
  } else if (isArrayBuffer(uncompressed)) {
    arrayBufferMode = true;
    uncompressedView = new Uint8Array(uncompressed);
  } else {
    uncompressedView = uncompressed;
  }

  const compressor = new SnappyCompressor(uncompressedView);
  const maxLength = compressor.maxCompressedLength();
  if (uint8Mode) {
    const compressed = new Uint8Array(maxLength);
    const length = compressor.compressToBuffer(compressed as Uint8Array);
    return compressed.subarray(0, length) as T;
  } else if (arrayBufferMode) {
    const compressed = new ArrayBuffer(maxLength) as T;
    const compressedView = new Uint8Array(compressed);
    const length = compressor.compressToBuffer(compressedView);
    return compressed.slice(0, length) as T;
  } else {
    const compressed = Buffer.allocUnsafe(maxLength) as T;
    const length = compressor.compressToBuffer(compressed as Uint8Array);
    return compressed.slice(0, length) as T;
  }
}
