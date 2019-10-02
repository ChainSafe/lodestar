import assert from "assert";

import {hash} from "../../util/hash";

import {
  sibling,
  parent,
  length,
  bit,
} from "./generalizedIndex";
import {GeneralizedIndex} from "./types";

/**
 * Get the generalized indices of the chunks along the path from the chunk with the
 * given tree index to the root.
 */
export function getPathIndices(treeIndex: GeneralizedIndex): GeneralizedIndex[] {
  const o = [treeIndex];
  while (o[o.length - 1] > 1n) {
    o.push(parent(o[o.length - 1]));
  }
  return o.slice(0, o.length - 1);
}

/**
 * Get the generalized indices of the sister chunks along the path from the chunk with the
 * given tree index to the root.
 */
export function getBranchIndices(treeIndex: GeneralizedIndex): GeneralizedIndex[] {
  const o = [sibling(treeIndex)];
  while (o[o.length - 1] > 1n) {
    o.push(sibling(parent(o[o.length - 1])));
  }
  return o.slice(0, o.length - 1);
}

/**
 * Get the generalized indices of all "extra" chunks in the tree needed to prove the chunks with the given
 * generalized indices. Note that the decreasing order is chosen deliberately to ensure equivalence to the
 * order of hashes in a regular single-item Merkle proof in the single-item case.
 */
export function getHelperIndices(indices: GeneralizedIndex[]): GeneralizedIndex[] {
  const allPathIndices = new Set<GeneralizedIndex>();
  const allHelperIndices = new Set<GeneralizedIndex>();
  for (const index of indices) {
    for (const pIndex of getPathIndices(index)) {
      allPathIndices.add(pIndex);
    }
    for (const brIndex of getBranchIndices(index)) {
      allHelperIndices.add(brIndex);
    }
  }
  return Array.from(allHelperIndices.values())
    .filter((index) => !allPathIndices.has(index))
    .sort((a, b) => a < b ? 1 : -1);
}

export function calculateMerkleRoot(leaf: Buffer, proof: Buffer[], index: GeneralizedIndex): Buffer {
  assert(proof.length === length(index));
  proof.forEach((h, i) => {
    if (bit(index, i)) {
      leaf = hash(Buffer.concat([h, leaf]));
    } else {
      leaf = hash(Buffer.concat([leaf, h]));
    }
  });
  return leaf;
}

export function verifyMerkleProof(leaf: Buffer, proof: Buffer[], index: GeneralizedIndex, root: Buffer): boolean {
  return calculateMerkleRoot(leaf, proof, index).equals(root);
}

export function calculateMultiMerkleRoot(leaves: Buffer[], proof: Buffer[], indices: GeneralizedIndex[]): Buffer {
  assert(leaves.length === indices.length);
  const helperIndices = getHelperIndices(indices);
  assert(proof.length === helperIndices.length);
  const objects = new Map<GeneralizedIndex, Buffer>();
  for(let i = 0; i < indices.length; i++) {
    objects.set(indices[i], leaves[i]);
  }
  for(let i = 0; i < helperIndices.length; i++) {
    objects.set(helperIndices[i], proof[i]);
  }
  const keys = [...objects.keys()].sort((a, b) => a < b ? 1 : -1);
  let pos = 0;
  while (pos < keys.length) {
    const k = keys[pos];
    const parentK = parent(k);
    if (
      objects.has(k) &&
      objects.has(sibling(k)) &&
      !objects.has(parentK)
    ) {
      objects.set(
        parentK,
        hash(Buffer.concat(
          k % 2n === 0n
            ? [objects.get(k), objects.get(sibling(k))]
            : [objects.get(sibling(k)), objects.get(k)]
        ))
      );
      keys.push(parentK);
    }
    pos += 1;
  }
  return objects.get(1n);
}

export function verifyMerkleMultiproof(
  leaves: Buffer[],
  proof: Buffer[],
  indices: GeneralizedIndex[],
  root: Buffer
): boolean {
  return calculateMultiMerkleRoot(leaves, proof, indices).equals(root);
}
