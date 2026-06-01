import {RootHex, Slot, electra, ssz} from "@lodestar/types";
import {MapDef, pruneSetToMax, toRootHex} from "@lodestar/utils";

/**
 * Upper bound on the number of distinct payload blockHashes for which we cache verified
 * builder-deposit signatures. Each block consumes the cache for its parent payload exactly
 * once, so 32 covers normal head progression and a healthy margin for short-lived forks.
 */
const MAX_VERIFIED_PAYLOAD_BLOCK_HASHES = 32;

/**
 * Caches pre-verified builder-deposit signatures so the Fulu → Gloas fork
 * transition can skip the bulk verification cost.
 *
 * Two sub-caches with distinct lifecycles:
 *
 * - `verifiedRootsByPreGloasSlot` — produced by `preVerifyBuilderDepositsPreGloas()` driven by
 *   `prepareForNextSlot` over the `GLOAS_PREVERIFY_WINDOW_EPOCHS` epochs leading up to
 *   GLOAS_FORK_EPOCH; consumed by `onboardBuildersFromPendingDeposits()` at the fork boundary.
 *   Cleared by `clearPreGloasCache()` once the finalized epoch reaches GLOAS_FORK_EPOCH.
 *
 * - `verifiedRootsByPayloadBlockHash` — produced by `preVerifyPayloadBuilderDeposits()`
 *   when an execution payload envelope is imported (block N); consumed by
 *   `processDepositRequest()` on the next block (block N+1) via
 *   `state.latestExecutionPayloadBid.blockHash`. Self-rolling: FIFO-bounded to
 *   `MAX_VERIFIED_PAYLOAD_BLOCK_HASHES` and intentionally not touched by `clear()`.
 *
 *
 * Single instance across application (created in `EpochCache.createFromState`,
 * shared by-reference through `clone()`).
 */
export class BuilderDepositSignatureCache {
  private verifiedRootsByPreGloasSlot: MapDef<Slot, Set<RootHex>> = new MapDef(() => new Set());
  // Plain Map (not MapDef) so insertion order is usable for FIFO eviction via pruneSetToMax.
  private verifiedRootsByPayloadBlockHash = new Map<RootHex, Set<RootHex>>();

  private _lastVerifiedSlot: Slot = 0;

  get lastVerifiedSlot(): Slot {
    return this._lastVerifiedSlot;
  }

  set lastVerifiedSlot(slot: Slot) {
    if (slot > this._lastVerifiedSlot) {
      this._lastVerifiedSlot = slot;
    }
  }

  setVerifiedPreGloas(builderDeposit: electra.PendingDeposit): void {
    const verifiedRoots = this.verifiedRootsByPreGloasSlot.getOrDefault(builderDeposit.slot);
    // Hash via PendingDepositNoSlot to save hashing cost as slot is not part of signature check
    verifiedRoots.add(toRootHex(ssz.electra.PendingDepositNoSlot.hashTreeRoot(builderDeposit)));
  }

  setVerifiedByPayload(payloadBlockHash: RootHex, builderDeposit: electra.PendingDepositNoSlot): void {
    let verifiedRoots = this.verifiedRootsByPayloadBlockHash.get(payloadBlockHash);
    if (!verifiedRoots) {
      verifiedRoots = new Set();
      this.verifiedRootsByPayloadBlockHash.set(payloadBlockHash, verifiedRoots);
    }
    verifiedRoots.add(toRootHex(ssz.electra.PendingDepositNoSlot.hashTreeRoot(builderDeposit)));
    // Always-prune as the final step. No-op when size ≤ cap (O(1) branch in pruneSetToMax).
    pruneSetToMax(this.verifiedRootsByPayloadBlockHash, MAX_VERIFIED_PAYLOAD_BLOCK_HASHES);
  }

  isVerifiedPreGloas(builderDeposit: electra.PendingDeposit): boolean {
    const verifiedRoots = this.verifiedRootsByPreGloasSlot.get(builderDeposit.slot);
    if (!verifiedRoots) {
      return false;
    }
    // setVerifiedPreGloas uses PendingDepositNoSlot to hash
    return verifiedRoots.has(toRootHex(ssz.electra.PendingDepositNoSlot.hashTreeRoot(builderDeposit)));
  }

  isVerifiedByPayload(payloadBlockHash: RootHex, builderDeposit: electra.PendingDepositNoSlot): boolean {
    const verifiedRoots = this.verifiedRootsByPayloadBlockHash.get(payloadBlockHash);
    if (!verifiedRoots) {
      return false;
    }
    return verifiedRoots.has(toRootHex(ssz.electra.PendingDepositNoSlot.hashTreeRoot(builderDeposit)));
  }

  /**
   * Clears only the pre-Gloas fork-transition slot cache. The payload-blockHash cache is
   * self-rolling via the FIFO cap in setVerifiedByPayload and is intentionally left
   * in place.
   */
  clearPreGloasCache(): void {
    this.verifiedRootsByPreGloasSlot.clear();
    this._lastVerifiedSlot = 0;
  }
}
