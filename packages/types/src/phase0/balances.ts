import {BranchNode, HashComputation, Node, executeHashComputations} from "@chainsafe/persistent-merkle-tree";
import {Balances} from "./sszTypes";

const chunksDepth = Balances.chunkDepth;
const hashComputations: HashComputation[][] = Array.from({length: chunksDepth}, () => []);

/**
 * Model HashComputation[] at the same level that support reusing the same memory.
 * Before every run, reset() should be called.
 */
class HashComputationLevel {
  private length: number;

  constructor(private readonly hashComps: HashComputation[]) {
    this.length = 0;
  }

  reset(): void {
    this.length = 0;
  }

  push(src0: Node, src1: Node, dest: Node): void {
    if (this.length < this.hashComps.length) {
      const existing = this.hashComps[this.length];
      existing.src0 = src0;
      existing.src1 = src1;
      existing.dest = dest;
    } else {
      this.hashComps.push({src0, src1, dest});
    }

    this.length++;
  }
}

// share the same memory with the above hashComputations
const hashComputationLevels: HashComputationLevel[] = hashComputations.map((hashComps) => (new HashComputationLevel(hashComps)));

/**
 * Convenient way to hash a balances node in batches.
 */
export function hashBalancesTree(balancesNode: Node): void {
  const rootNode = balancesNode as BranchNode;
  const chunksNode = rootNode.left;
  for (const level of hashComputationLevels) {
    level.reset();
  }

  getHashComputations(chunksNode, 0, hashComputationLevels);
  executeHashComputations(hashComputations);

  if (chunksNode.h0 === null) {
    throw Error("Chunks node should be hashed");
  }

  balancesNode.rootHashObject;
}

/**
 * Get HashComputations from a root node all the way to the leaf nodes.
 */
function getHashComputations(node: Node, offset: number, hashCompsByLevel: HashComputationLevel[]): void {
  if (node.h0 === null) {
    const level = hashCompsByLevel[offset];
    const {left, right} = node;
    level.push(left, right, node);
    // leaf nodes should have h0 to stop the recursion
    getHashComputations(left, offset + 1, hashCompsByLevel);
    getHashComputations(right, offset + 1, hashCompsByLevel);
  }

  // else stop the recursion, node is hashed
}
