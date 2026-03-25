import {EXECUTION_PROOF_TYPE_COUNT} from "@lodestar/params";
import {ExecutionProof} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {InsertOutcome} from "./types.js";

type NewPayloadRequestRootHex = string;
type ProofType = number;

/**
 * Max number of distinct newPayloadRequestRoot entries to prevent unbounded growth.
 * Each root can have up to EXECUTION_PROOF_TYPE_COUNT proofs.
 */
const MAX_ROOT_ENTRIES = 64;

/**
 * EIP-8025: In-memory pool for execution proofs.
 *
 * Indexed by newPayloadRequestRoot (from proof.publicInput) → proofType.
 * Stores verified execution proofs received via gossip or API submission.
 * Used to:
 * - Track proof availability for blocks (zkvm mode gating)
 * - Serve proofs via req/resp to peers
 * - Deduplicate incoming proofs
 */
export class ExecutionProofPool {
  private readonly proofsByRoot = new MapDef<NewPayloadRequestRootHex, Map<ProofType, ExecutionProof>>(() => new Map());

  /** Total number of individual proofs in the pool */
  get size(): number {
    let count = 0;
    for (const byType of this.proofsByRoot.values()) {
      count += byType.size;
    }
    return count;
  }

  /**
   * Add a verified proof to the pool.
   * Deduplicates by (newPayloadRequestRoot, proofType) — only one proof per type per payload request.
   */
  add(proof: ExecutionProof): InsertOutcome {
    const rootHex = toRootHex(proof.publicInput.newPayloadRequestRoot);
    const {proofType} = proof;

    if (proofType >= EXECUTION_PROOF_TYPE_COUNT) {
      return InsertOutcome.Old; // Invalid proof type
    }

    const byType = this.proofsByRoot.getOrDefault(rootHex);
    if (byType.has(proofType)) {
      return InsertOutcome.AlreadyKnown;
    }

    // Prevent unbounded memory growth
    if (this.proofsByRoot.size >= MAX_ROOT_ENTRIES && !this.proofsByRoot.has(rootHex)) {
      return InsertOutcome.Old;
    }

    byType.set(proofType, proof);
    return InsertOutcome.NewData;
  }

  /**
   * Get all proofs for a given newPayloadRequestRoot.
   */
  getProofsByNewPayloadRequestRoot(rootHex: NewPayloadRequestRootHex): ExecutionProof[] {
    const byType = this.proofsByRoot.get(rootHex);
    return byType ? Array.from(byType.values()) : [];
  }

  /**
   * Get all proofs in the pool. Used for API listing.
   */
  getAllProofs(): ExecutionProof[] {
    const proofs: ExecutionProof[] = [];
    for (const byType of this.proofsByRoot.values()) {
      for (const proof of byType.values()) {
        proofs.push(proof);
      }
    }
    return proofs;
  }

  /**
   * Check whether a newPayloadRequestRoot has enough distinct proof types for availability.
   */
  hasEnoughProofs(rootHex: NewPayloadRequestRootHex, minRequired: number): boolean {
    const byType = this.proofsByRoot.get(rootHex);
    return byType !== undefined && byType.size >= minRequired;
  }

  /**
   * Check if a specific (newPayloadRequestRoot, proofType) combination is already known.
   * Used for gossip deduplication (IGNORE if already seen).
   */
  has(rootHex: NewPayloadRequestRootHex, proofType: ProofType): boolean {
    return this.proofsByRoot.get(rootHex)?.has(proofType) ?? false;
  }

  /**
   * Remove all proofs for a given newPayloadRequestRoot.
   * Called when block is finalized or proof set is no longer needed.
   */
  pruneByRoot(rootHex: NewPayloadRequestRootHex): void {
    this.proofsByRoot.delete(rootHex);
  }

  /**
   * Remove oldest entries to keep pool within MAX_ROOT_ENTRIES.
   * Uses insertion order (Map iteration order) as a proxy for age.
   */
  prune(): void {
    while (this.proofsByRoot.size > MAX_ROOT_ENTRIES) {
      const firstKey = this.proofsByRoot.keys().next().value;
      if (firstKey === undefined) break;
      this.proofsByRoot.delete(firstKey);
    }
  }
}
