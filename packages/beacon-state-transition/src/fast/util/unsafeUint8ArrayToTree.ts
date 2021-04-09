import {LeafNode, Node, subtreeFillToContents} from "@chainsafe/persistent-merkle-tree";

/**
 * Convert a Uint8Array to a merkle tree, using the underlying array's underlying ArrayBuffer
 *
 * `data` MUST NOT be modified after this, or risk the merkle nodes being modified.
 */
export function unsafeUint8ArrayToTree(data: Uint8Array, depth: number): Node {
  const leaves: LeafNode[] = [];

  // Loop 32 bytes at a time, creating leaves from the backing subarray
  const maxStartIndex = data.length - 31;
  for (let i = 0; i < maxStartIndex; i += 32) {
    leaves.push(new LeafNode(data.subarray(i, i + 32)));
  }

  // If there is any extra data at the end (less than 32 bytes), append a final leaf
  const lengthMod32 = data.length % 32;
  if (lengthMod32 !== 0) {
    const finalChunk = new Uint8Array(32);
    finalChunk.set(data.subarray(data.length - lengthMod32));
    leaves.push(new LeafNode(finalChunk));
  }

  return subtreeFillToContents(leaves, depth);
}
