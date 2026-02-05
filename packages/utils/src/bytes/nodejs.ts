export function toHex(buffer: Uint8Array | Parameters<typeof Buffer.from>[0]): string {
  if (Buffer.isBuffer(buffer)) {
    return "0x" + buffer.toString("hex");
  }
  if (buffer instanceof Uint8Array) {
    return "0x" + Buffer.from(buffer.buffer, buffer.byteOffset, buffer.length).toString("hex");
  }
  return "0x" + Buffer.from(buffer).toString("hex");
}

// Shared buffer to convert root to hex
let rootBuf: Buffer | undefined;

/**
 * Convert a Uint8Array, length 32, to 0x-prefixed hex string
 */
export function toRootHex(root: Uint8Array): string {
  if (root.length !== 32) {
    throw Error(`Expect root to be 32 bytes, got ${root.length}`);
  }

  if (rootBuf === undefined) {
    rootBuf = Buffer.alloc(32);
  }

  rootBuf.set(root);
  return `0x${rootBuf.toString("hex")}`;
}

// Shared buffer to convert pubkey to hex
let pubkeyBuf: Buffer | undefined;

export function toPubkeyHex(pubkey: Uint8Array): string {
  if (pubkey.length !== 48) {
    throw Error(`Expect pubkey to be 48 bytes, got ${pubkey.length}`);
  }

  if (pubkeyBuf === undefined) {
    pubkeyBuf = Buffer.alloc(48);
  }

  pubkeyBuf.set(pubkey);
  return `0x${pubkeyBuf.toString("hex")}`;
}

export function fromHex(hex: string): Uint8Array {
  if (typeof hex !== "string") {
    throw new Error(`hex argument type ${typeof hex} must be of type string`);
  }

  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }

  if (hex.length % 2 !== 0) {
    throw new Error(`hex string length ${hex.length} must be multiple of 2`);
  }

  const b = Buffer.from(hex, "hex");
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}

/// the performance of fromHexInto using a preallocated buffer is very bad compared to browser so I moved it to the benchmark

/**
 * Compare two byte arrays for equality using the most performant method based on size.
 *
 * Node v24.13.0 benchmark results:
 * - 32 bytes:   Loop 14.7 ns/op vs Buffer.compare 49.7 ns/op (Loop 3.4x faster)
 * - 48 bytes:   Loop 36 ns/op vs Buffer.compare 56 ns/op (Loop 1.5x faster)
 * - 96 bytes:   Loop 130 ns/op vs Buffer.compare 50 ns/op (Buffer 2.6x faster)
 * - 1024 bytes: Loop 940 ns/op vs Buffer.compare 55 ns/op (Buffer 17x faster)
 *
 * Uses loop for small arrays (<=48 bytes) where V8 JIT is more efficient,
 * and Buffer.compare for larger arrays where native code wins.
 */
export function byteArrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  // For small arrays (<=48 bytes: roots, pubkeys), loop is faster due to V8 JIT optimizations
  if (a.length <= 48) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  // For larger arrays, Buffer.compare uses native code and is significantly faster
  return Buffer.compare(a, b) === 0;
}

export {bigIntToBytes, bytesToBigInt, bytesToInt, fromHexInto, intToBytes, toHexString, xor} from "./browser.ts";
