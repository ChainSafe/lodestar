import {CompactMultiProof, Node, ProofType, createProof, descriptorToBitlist} from "@chainsafe/persistent-merkle-tree";

/** Throws an Error with code INVALID_PROOF_TRAVERSAL when a descriptor descends below a terminal chunk. */
export function createCompactMultiProof(root: Node, descriptor: Uint8Array): CompactMultiProof {
  // Check terminal chunks explicitly; the proof library throws untyped traversal errors.
  const nodes = [root];
  for (const terminal of descriptorToBitlist(descriptor)) {
    const node = nodes.pop();
    if (node === undefined) throw new Error("Invalid compact proof traversal stack");
    if (!terminal) {
      if (node.isLeaf()) throw new InvalidProofTraversalError();
      nodes.push(node.right, node.left);
    }
  }
  return createProof(root, {type: ProofType.compactMulti, descriptor}) as CompactMultiProof;
}

class InvalidProofTraversalError extends Error {
  readonly code = "INVALID_PROOF_TRAVERSAL";

  constructor() {
    super("Proof descriptor requests children of a terminal chunk");
    this.name = "InvalidProofTraversalError";
  }
}
