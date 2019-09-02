/** @module ssz */
import {
  FullSSZType,
  SerializableValue,
} from "../types";
import {BYTES_PER_CHUNK} from "../constants";
import {size} from "../size";
import {_serialize} from "../serialize";
import {hash} from "../hash";

// create array of "zero hashes", successively hashed zero chunks
const zeroHashes = [Buffer.alloc(BYTES_PER_CHUNK)];
for (let i = 0; i < 52; i++) {
  zeroHashes.push(hash(zeroHashes[i], zeroHashes[i]));
}

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
  return chunkify(packedBuf);
}

/** @ignore */
export function chunkify (input: Buffer): Buffer[] {
  const chunkLength = Math.max(Math.ceil(input.length / BYTES_PER_CHUNK), 1);
  // Chop buffer into chunks
  const chunks = Array.from({length: chunkLength},
    (_, i) => input.slice(i * BYTES_PER_CHUNK, i * BYTES_PER_CHUNK + BYTES_PER_CHUNK));
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
    // rshift only works to 32 bits, so we int div by 2 instead
    n = Math.floor(n / 2);
    length++;
  }
  return length;
}

/** @ignore */
function nextPowerOf2 (n: number): number {
  return n <= 0 ? 1 : Math.pow(2, bitLength(n - 1));
}

/** @ignore */
export function merkleize(chunks: Buffer[], padFor: number = 0): Buffer {
  let lengthToPad = nextPowerOf2(padFor || chunks.length) - chunks.length;
  // Instead of pushing on all padding zero chunks at the leaf level
  // we push on zero hash chunks at the highest possible level to avoid over-hashing
  for (let layer = 0; chunks.length + lengthToPad > 0; layer++) {
    const addZeroHash = lengthToPad % 2 == 1;
    lengthToPad = Math.floor(lengthToPad / 2);

    // if the lengthToAdd is odd, then the chunks.length is also odd
    // we need to push on the zero-hash of that level to merkleize that level
    if (addZeroHash) {
      chunks.push(zeroHashes[layer]);
    }
    if (chunks.length == 1) {
      break;
    }
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
