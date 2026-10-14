import {RootHex, Slot, ValidatorIndex, eip8025} from "@lodestar/types";

type BlockProofs = {
  slot: Slot;
  verified: Map<eip8025.ProofType, eip8025.ExecutionProofEnvelope>;
  proofRoots: Set<RootHex>;
  provers: Set<string>;
};

/**
 * Verified execution proof envelopes per beacon block root and proof type (spec `Store.execution_proofs`)
 * and the gossip dedup sets (spec `Seen.execution_proof_roots` and `Seen.execution_proof_provers`).
 * Proving takes minutes, so entries outlive the block's import and are pruned on finalization.
 */
export class SeenExecutionProofs {
  private readonly blocks = new Map<RootHex, BlockProofs>();

  hasVerified(blockRoot: RootHex, proofType: eip8025.ProofType): boolean {
    return this.blocks.get(blockRoot)?.verified.has(proofType) === true;
  }

  getVerified(blockRoot: RootHex, proofType: eip8025.ProofType): eip8025.ExecutionProofEnvelope | undefined {
    return this.blocks.get(blockRoot)?.verified.get(proofType);
  }

  addVerified(blockRoot: RootHex, slot: Slot, proofEnvelope: eip8025.ExecutionProofEnvelope): void {
    const block = this.getOrCreate(blockRoot, slot);
    if (!block.verified.has(proofEnvelope.proofType)) {
      block.verified.set(proofEnvelope.proofType, proofEnvelope);
    }
  }

  isProofSeen(blockRoot: RootHex, proofRoot: RootHex): boolean {
    return this.blocks.get(blockRoot)?.proofRoots.has(proofRoot) === true;
  }

  isProverSeen(blockRoot: RootHex, proofType: eip8025.ProofType, validatorIndex: ValidatorIndex): boolean {
    return this.blocks.get(blockRoot)?.provers.has(proverKey(proofType, validatorIndex)) === true;
  }

  markSeen(
    blockRoot: RootHex,
    slot: Slot,
    proofRoot: RootHex,
    proofType: eip8025.ProofType,
    validatorIndex: ValidatorIndex
  ): void {
    const block = this.getOrCreate(blockRoot, slot);
    block.proofRoots.add(proofRoot);
    block.provers.add(proverKey(proofType, validatorIndex));
  }

  prune(finalizedSlot: Slot): void {
    for (const [blockRoot, block] of this.blocks) {
      if (block.slot < finalizedSlot) {
        this.blocks.delete(blockRoot);
      }
    }
  }

  private getOrCreate(blockRoot: RootHex, slot: Slot): BlockProofs {
    let block = this.blocks.get(blockRoot);
    if (block === undefined) {
      block = {slot, verified: new Map(), proofRoots: new Set(), provers: new Set()};
      this.blocks.set(blockRoot, block);
    }
    return block;
  }
}

function proverKey(proofType: eip8025.ProofType, validatorIndex: ValidatorIndex): string {
  return `${proofType}:${validatorIndex}`;
}
