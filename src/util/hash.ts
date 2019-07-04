/** @module ssz */
import {
  FullSSZType,
  SerializableValue,
} from "../types";
import { BYTES_PER_CHUNK } from "../constants";
import { size } from "../size";
import { _serialize } from "../serialize";
import { hash } from "../hash";

/** @ignore */
export function pack (input: SerializableValue[], type: FullSSZType): Buffer[] {
  if (input.length === 0) {
    return [];
  }
  // Serialize inputs into one long buffer
  const packedLength = input.map((v) => size(v, type)).reduce((a, b) => a + b, 0);
  const packedBuf = Buffer.alloc(packedLength);
  let index = 0;
  for (const v of input) {
    index = _serialize(v, type, packedBuf, index);
  }
  const chunkLength = Math.max(Math.ceil(packedLength / BYTES_PER_CHUNK), 1);
  // Chop buffer into chunks
  const chunks = Array.from({ length: chunkLength },
    (_, i) => packedBuf.slice(i * BYTES_PER_CHUNK, i * BYTES_PER_CHUNK + BYTES_PER_CHUNK));
  const lastChunk = chunks[chunkLength - 1];
  if (lastChunk.length < BYTES_PER_CHUNK) {
    chunks[chunkLength - 1] = Buffer.concat([lastChunk, Buffer.alloc(BYTES_PER_CHUNK - lastChunk.length)]);
  }
  return chunks;
}

/** @ignore */
function bitLength (n: number): number {
  let length = 0;
  while (n !== 0) {
    n = n >> 1;
    length++;
  }
  return length;
}

/** @ignore */
function nextPowerOf2 (n: number): number {
  return n === 0 ? 1 : Math.pow(2, bitLength(n - 1));
}

/** @ignore */
export function merkleize(chunks: Buffer[], padFor: number = 0): Buffer {
  const lengthToPad = nextPowerOf2(padFor || chunks.length) - chunks.length;
  if (lengthToPad) {
    // Add zeroed chunks as leaf nodes to create full binary tree
    const emptyChunk = Buffer.alloc(BYTES_PER_CHUNK);
    chunks = chunks.concat(
      Array.from({ length: lengthToPad }, () => emptyChunk)
    );
  }
  while (chunks.length > 1) {
    for (let i = 0; i < chunks.length; i += 2) {
      chunks[i / 2] = hash(chunks[i], chunks[i + 1]);
    }
    chunks.splice(chunks.length / 2, chunks.length / 2);
  }
  return chunks[0];
}

/** @ignore */
export function mixInLength(root: Buffer, length: number): Buffer {
  const lengthBuf = Buffer.alloc(32);
  lengthBuf.writeUIntLE(length, 0, 6);
  return hash(root, lengthBuf);
}
