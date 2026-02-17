import {EXECUTION_PROOF_TYPE_COUNT} from "@lodestar/params";
import {ExecutionProof, Slot} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {InsertOutcome} from "./types.js";
import {pruneBySlot} from "./utils.js";

/**
 * Number of slots to retain proofs for.
 * Keep proofs around for a few slots in case of reorgs.
 */
const SLOTS_RETAINED = 8;

type BlockRootHex = string;
type ProofId = number;

/**
 * EIP-8025: In-memory pool for execution proofs, indexed by slot → blockRoot → proofId.
 *
 * Stores verified execution proofs received via gossip or API submission.
 * Used to:
 * - Track proof availability for blocks (zkvm mode gating)
 * - Serve proofs via req/resp to peers
 * - Deduplicate incoming proofs
 */
export class ExecutionProofPool {
  private readonly proofsByBlockRootBySlot = new MapDef<Slot, MapDef<BlockRootHex, Map<ProofId, ExecutionProof>>>(
    () => new MapDef<BlockRootHex, Map<ProofId, ExecutionProof>>(() => new Map())
  );
  /** Reverse index: blockRootHex → slot for O(1) lookups */
  private readonly blockRootToSlot = new Map<BlockRootHex, Slot>();
  private lowestPermissibleSlot = 0;

  /** Total number of individual proofs in the pool */
  get size(): number {
    let count = 0;
    for (const byBlockRoot of this.proofsByBlockRootBySlot.values()) {
      for (const byProofId of byBlockRoot.values()) {
        count += byProofId.size;
      }
    }
    return count;
  }

  /**
   * Add a verified proof to the pool.
   * Deduplicates by (blockRoot, proofId) — only one proof per type per block.
   */
  add(proof: ExecutionProof): InsertOutcome {
    const {slot, blockRoot, proofId} = proof;

    if (slot < this.lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    if (proofId >= EXECUTION_PROOF_TYPE_COUNT) {
      return InsertOutcome.Old; // Invalid proof type
    }

    const blockRootHex = toRootHex(blockRoot);
    const proofsByProofId = this.proofsByBlockRootBySlot.getOrDefault(slot).getOrDefault(blockRootHex);

    if (proofsByProofId.has(proofId)) {
      return InsertOutcome.AlreadyKnown;
    }

    proofsByProofId.set(proofId, proof);
    this.blockRootToSlot.set(blockRootHex, slot);
    return InsertOutcome.NewData;
  }

  /**
   * Get all proofs for a given block root. O(1) slot lookup via reverse index.
   */
  getProofsByBlockRoot(blockRootHex: BlockRootHex): ExecutionProof[] {
    const slot = this.blockRootToSlot.get(blockRootHex);
    if (slot === undefined) return [];

    const byProofId = this.proofsByBlockRootBySlot.get(slot)?.get(blockRootHex);
    return byProofId ? Array.from(byProofId.values()) : [];
  }

  /**
   * Get proofs for a range of slots. Used to serve ExecutionProofsByRange req/resp.
   */
  getProofsByRange(startSlot: Slot, count: number): ExecutionProof[] {
    const proofs: ExecutionProof[] = [];
    for (let slot = startSlot; slot < startSlot + count; slot++) {
      const byBlockRoot = this.proofsByBlockRootBySlot.get(slot);
      if (byBlockRoot) {
        for (const byProofId of byBlockRoot.values()) {
          for (const proof of byProofId.values()) {
            proofs.push(proof);
          }
        }
      }
    }
    return proofs;
  }

  /**
   * Check whether a block has enough distinct proof types for availability.
   * O(1) slot lookup via reverse index.
   */
  hasEnoughProofs(blockRootHex: BlockRootHex, minRequired: number): boolean {
    const slot = this.blockRootToSlot.get(blockRootHex);
    if (slot === undefined) return false;

    const byProofId = this.proofsByBlockRootBySlot.get(slot)?.get(blockRootHex);
    return byProofId !== undefined && byProofId.size >= minRequired;
  }

  /**
   * Check if a specific (blockRoot, proofId) combination is already known.
   * Used for gossip deduplication (IGNORE if already seen).
   * O(1) slot lookup via reverse index.
   */
  has(blockRootHex: BlockRootHex, proofId: ProofId): boolean {
    const slot = this.blockRootToSlot.get(blockRootHex);
    if (slot === undefined) return false;

    return this.proofsByBlockRootBySlot.get(slot)?.get(blockRootHex)?.has(proofId) ?? false;
  }

  /**
   * Prune proofs older than clockSlot - SLOTS_RETAINED.
   * Called periodically (e.g., on slot clock tick).
   */
  prune(clockSlot: Slot): void {
    // Clean up reverse index for pruned slots
    const cutoffSlot = clockSlot - SLOTS_RETAINED;
    for (const [blockRootHex, slot] of this.blockRootToSlot) {
      if (slot < cutoffSlot) {
        this.blockRootToSlot.delete(blockRootHex);
      }
    }
    this.lowestPermissibleSlot = pruneBySlot(this.proofsByBlockRootBySlot, clockSlot, SLOTS_RETAINED);
  }
}
