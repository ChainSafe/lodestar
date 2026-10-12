import {RootHex, Slot, ValidatorIndex, eip8025} from "@lodestar/types";

type BlockProofs = {
  slot: Slot;
  verified: Set<eip8025.ProofType>;
  proofRoots: Set<RootHex>;
  provers: Set<string>;
};

/**
 * Execution proofs per beacon block root: which proof types are verified (spec `Store.execution_proofs`,
 * without the envelopes, since `proofData` is up to 4 MiB and nothing serves it yet) and the gossip dedup
 * sets (spec `Seen.execution_proof_roots` and `Seen.execution_proof_provers`).
 * Proving takes minutes, so entries outlive the block's import and are pruned on finalization.
 */
export class SeenExecutionProofs {
  private readonly blocks = new Map<RootHex, BlockProofs>();

  hasVerified(blockRoot: RootHex, proofType: eip8025.ProofType): boolean {
    return this.blocks.get(blockRoot)?.verified.has(proofType) === true;
  }

  addVerified(blockRoot: RootHex, slot: Slot, proofType: eip8025.ProofType): void {
    this.getOrCreate(blockRoot, slot).verified.add(proofType);
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
      block = {slot, verified: new Set(), proofRoots: new Set(), provers: new Set()};
      this.blocks.set(blockRoot, block);
    }
    return block;
  }
}

function proverKey(proofType: eip8025.ProofType, validatorIndex: ValidatorIndex): string {
  return `${proofType}:${validatorIndex}`;
}
