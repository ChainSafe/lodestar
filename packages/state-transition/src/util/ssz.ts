import {BranchNode, LeafNode, Node, zeroNode} from "@chainsafe/persistent-merkle-tree";
import {progressiveSubtreeFillToContents} from "@chainsafe/ssz";

// TODO: move these utils to @chainsafe/ssz, see https://github.com/ChainSafe/ssz/issues/542

/** Root node (chunks + length mix-in) of a zero-filled ProgressiveListBasicType of `length` items */
export function zeroProgressiveListBasicRootNode(itemsPerChunk: number, length: number): Node {
  const chunkCount = Math.ceil(length / itemsPerChunk);
  // mirrors ssz's progressiveSubtreeCount (subtree capacities 1, 4, 16, ...)
  let numSubtrees = 0;
  for (let remaining = chunkCount, subtreeLength = 1; remaining > 0; subtreeLength *= 4) {
    remaining -= Math.min(remaining, subtreeLength);
    numSubtrees++;
  }
  return new BranchNode(zeroProgressiveNode(numSubtrees), LeafNode.fromUint32(length));
}

/**
 * Check if an array-type ViewDU (ListBasic, ListComposite or their progressive equivalents) has its
 * internal nodes cache populated. The flag is a private attribute maintained by all of these classes.
 */
export function isViewDUNodesPopulated(view: unknown): boolean {
  return (view as {nodesPopulated?: boolean}).nodesPopulated === true;
}

/**
 * Root node of a progressive list from its chunk/element nodes + length mix-in.
 * `nodes` are packed 32-byte chunk leaves for basic lists, or element root nodes for composite lists.
 */
export function progressiveListRootNode(nodes: Node[], length: number): Node {
  return new BranchNode(progressiveSubtreeFillToContents(nodes), LeafNode.fromUint32(length));
}

/**
 * Return the chunks node of a zero-filled progressive merkle list spanning `numSubtrees`
 * balanced subtrees (chunk capacities 1, 4, 16, ... = 4^i; depths 0, 2, 4, ... = 2i).
 *
 * Not memoized: the zero data is already fully shared via the cached zeroNode(2i) subtrees;
 * only the O(numSubtrees) spine BranchNodes (~10 at 2M validators) are allocated per call.
 */
function zeroProgressiveNode(numSubtrees: number): Node {
  // chain(k) = B(zeroNode(0), B(zeroNode(2), ... B(zeroNode(2(k-1)), zeroNode(0))))
  let node: Node = zeroNode(0); // terminator
  for (let i = numSubtrees - 1; i >= 0; i--) {
    // BranchNode(left: balanced subtree i, right: rest of chain) — chain grows to the right,
    // same as ssz progressiveSubtreeFillToContents: `root = new BranchNode(subtreeRoots[i], root)`
    node = new BranchNode(zeroNode(2 * i), node);
  }
  return node;
}
