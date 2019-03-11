import {
  bytes,
  bytes32,
} from "../types";

import {
  hash
} from "../chain/helpers/stateTransitionHelpers";

/**
 * Verify the merkle branch against the root
 * We assume the depth of the merkle tree is 32
 */
export function validMerkleProof(data: bytes, root: bytes32, index: number, branch: bytes): boolean {
  const branchChunks: bytes32[] = Array.from({ length: branch.length / 32 },
    (_, i) => branch.slice(i * 32, (i+1) * 32));
  const indices = branchIndices(index, 32);
  let node: bytes32 = hash(data);
  branchChunks.forEach((chunk, i) => {
    if (indices[i] % 2 == 0) {
      node = hash(Buffer.concat([node, chunk]));
    } else {
      node = hash(Buffer.concat([chunk, node]));
    }
  })
  return root.equals(node);
}

/**
 * Return the incides of all ancestors up to the root given the index
 */
function branchIndices(merkleIndex: number, depth: number): number[] {
  let ix = merkleIndex;
  const indices = Array.from({ length: depth }, () => 0);
  indices[0] = ix;
  for (let i = 1; i < depth; i++) {
    ix = Math.floor(ix / 2);
    if (ix == 0) {
      break;
    }
    indices[i] = ix;
  }
  return indices;
}
