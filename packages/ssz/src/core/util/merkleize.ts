/** @module ssz */
import {BYTES_PER_CHUNK} from "../../util/constants";
import {hash} from "../../util/hash";
import {nextPowerOf2, bitLength} from "../../util/math";
import {zeroHashes} from "../../util/zeros";

/** @ignore */
export function merkleize(chunks: Buffer[], padFor: number = 0): Buffer {
  const layerCount = bitLength(nextPowerOf2(padFor || chunks.length) - 1);
  if (chunks.length == 0) {
    return zeroHashes[layerCount];
  }
  // Instead of pushing on all padding zero chunks at the leaf level
  // we push on zero hash chunks at the highest possible level to avoid over-hashing
  let layer = 0;
  while (layer < layerCount) {
    // if the chunks.length is odd
    // we need to push on the zero-hash of that level to merkleize that level
    if (chunks.length % 2 == 1) {
      chunks.push(zeroHashes[layer]);
    }
    for (let i = 0; i < chunks.length; i += 2) {
      chunks[i / 2] = hash(chunks[i], chunks[i + 1]);
    }
    chunks.splice(chunks.length / 2, chunks.length / 2);
    layer++;
  }
  return chunks[0];
}

/** @ignore */
export function mixInLength(root: Buffer, length: number): Buffer {
  const lengthBuf = Buffer.alloc(32);
  lengthBuf.writeUIntLE(length, 0, 6);
  return hash(root, lengthBuf);
}
