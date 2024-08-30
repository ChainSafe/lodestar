export function toHex(bytes: Uint8Array): string {
  const charCodes = new Array<number>(bytes.length * 2 + 2);
  charCodes[0] = 48;
  charCodes[1] = 120;

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    const first = (byte & 0xf0) >> 4;
    const second = byte & 0x0f;

    // "0".charCodeAt(0) = 48
    // "a".charCodeAt(0) = 97 => delta = 87
    charCodes[2 + 2 * i] = first < 10 ? first + 48 : first + 87;
    charCodes[2 + 2 * i + 1] = second < 10 ? second + 48 : second + 87;
  }
  return String.fromCharCode(...charCodes);
}

const rootCharCodes = new Array<number>(32 * 2 + 2);
// "0".charCodeAt(0)
rootCharCodes[0] = 48;
// "x".charCodeAt(0)
rootCharCodes[1] = 120;

/**
 * Convert a Uint8Array, length 32, to 0x-prefixed hex string
 */
export function toRootHex(root: Uint8Array): string {
  if (root.length !== 32) {
    throw Error(`Expect root to be 32 bytes, got ${root.length}`);
  }

  for (let i = 0; i < root.length; i++) {
    const byte = root[i];
    const first = (byte & 0xf0) >> 4;
    const second = byte & 0x0f;

    // "0".charCodeAt(0) = 48
    // "a".charCodeAt(0) = 97 => delta = 87
    rootCharCodes[2 + 2 * i] = first < 10 ? first + 48 : first + 87;
    rootCharCodes[2 + 2 * i + 1] = second < 10 ? second + 48 : second + 87;
  }
  return String.fromCharCode(...rootCharCodes);
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

  const byteLen = hex.length / 2;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    const byte = parseInt(hex.slice(i * 2, (i + 1) * 2), 16);
    bytes[i] = byte;
  }
  return bytes;
}
