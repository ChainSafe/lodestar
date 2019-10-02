/** @module ssz */
import {hash} from "../../util/hash";
import {nextPowerOf2, bitLength} from "../../util/math";
import {zeroHashes} from "../../util/zeros";

import {GeneralizedIndex, IProofBuilder} from "./types";
import {concat, parent, child} from "./generalizedIndex";

/** @ignore */
export function merkleize<T>(
  proofBuilder: IProofBuilder<T>,
  rootIndex: GeneralizedIndex,
  chunks: Buffer[],
  padFor: number = 0
): Buffer {
  const layerCount = bitLength(nextPowerOf2(padFor || chunks.length) - 1);
  if (chunks.length == 0) {
    proofBuilder.add(rootIndex, zeroHashes[layerCount]);
    return zeroHashes[layerCount];
  }
  let layerFirstIndex = concat([rootIndex, 2n ** BigInt(layerCount)]);
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
      // first set chunks in proof
      proofBuilder.add(layerFirstIndex + BigInt(i), chunks[i]);
      proofBuilder.add(layerFirstIndex + BigInt(i + 1), chunks[i + 1]);
      // then hash into parent
      chunks[i / 2] = hash(chunks[i], chunks[i + 1]);
    }
    chunks.splice(chunks.length / 2, chunks.length / 2);
    layer++;
    layerFirstIndex = parent(layerFirstIndex);
  }
  proofBuilder.add(rootIndex, chunks[0]);
  return chunks[0];
}

/** @ignore */
export function mixInLength<T>(
  proofBuilder: IProofBuilder<T>,
  rootIndex: GeneralizedIndex,
  root: Buffer,
  length: number,
): Buffer {
  const lengthBuf = Buffer.alloc(32);
  lengthBuf.writeUIntLE(length, 0, 6);
  proofBuilder.add(child(rootIndex, true), lengthBuf);
  const h = hash(root, lengthBuf);
  proofBuilder.add(rootIndex, h);
  return h;
}
