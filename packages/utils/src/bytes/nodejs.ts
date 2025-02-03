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
