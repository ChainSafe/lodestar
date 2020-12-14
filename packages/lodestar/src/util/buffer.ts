/**
 * Cast Uint8Array to Buffer efficiently
 */
export function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
}
