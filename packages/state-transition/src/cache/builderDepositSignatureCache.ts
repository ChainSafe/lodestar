import {RootHex, Slot, electra, ssz} from "@lodestar/types";
import {MapDef, pruneSetToMax, toRootHex} from "@lodestar/utils";

/**
 * Upper bound on the number of distinct payload blockHashes for which we cache verified
 * builder-deposit signatures. Each block consumes the cache for its parent payload exactly
 * once, so 32 covers normal head progression and a healthy margin for short-lived forks.
 */
const MAX_VERIFIED_PAYLOAD_BLOCK_HASHES = 32;

/**
 * Sentinel for `lastVerifiedSlot` meaning "no slot has been verified yet". GENESIS_SLOT
 * is `0`, which is a real, valid slot for early devnet deposits, so we use `-1` instead.
 */
export const NO_VERIFIED_SLOT: Slot = -1;

/**
 * Caches builder-deposit signature-verification results — both passes (`true`) and
 * failures (`false`) — so the Fulu → Gloas fork transition and post-Gloas block
 * processing can skip the bulk verification cost AND skip re-verifying deposits already
 * proven invalid.
 *
 * Two sub-caches with distinct lifecycles:
 *
 * - `preGloasResultsBySlot` — produced by `preVerifyBuilderDepositsPreGloas()` driven by
 *   `prepareForNextSlot` over the `GLOAS_PREVERIFY_WINDOW_EPOCHS` epochs leading up to
 *   GLOAS_FORK_EPOCH; consumed by `onboardBuildersFromPendingDeposits()` at the fork boundary.
 *   Cleared by `clearPreGloasCache()` once the finalized epoch reaches GLOAS_FORK_EPOCH.
 *
 * - `payloadResultsByBlockHash` — produced by `preVerifyPayloadBuilderDeposits()` when an
 *   execution payload envelope is imported (block N); consumed by `processDepositRequest()`
 *   on the next block (block N+1) via `state.latestExecutionPayloadBid.blockHash`.
 *   Self-rolling: FIFO-bounded to `MAX_VERIFIED_PAYLOAD_BLOCK_HASHES` and intentionally not
 *   touched by `clearPreGloasCache()`.
 *
 * Both sub-caches hash deposit entries via `hashTreeRoot(PendingDepositNoSlot)` —
 * the deposit's slot is either already encoded in the outer Map key (pre-Gloas) or
 * unknown at producer time (payload), and signature verification doesn't depend on slot.
 *
 * Producers must call `setPreGloasResult` / `setPayloadResult` for **every** deposit they
 * verify (pass or fail), so a `null` result from `getPreGloasResult` / `getPayloadResult`
 * unambiguously means "this deposit hasn't been verified yet" rather than "this deposit
 * was verified and rejected".
 *
 * Single instance across application (created in `EpochCache.createFromState`,
 * shared by-reference through `clone()`).
 */
export class BuilderDepositSignatureCache {
  private preGloasResultsBySlot: MapDef<Slot, Map<RootHex, boolean>> = new MapDef(() => new Map());
  // Plain Map (not MapDef) so insertion order is usable for FIFO eviction via pruneSetToMax.
  private payloadResultsByBlockHash = new Map<RootHex, Map<RootHex, boolean>>();

  private _lastVerifiedSlot: Slot = NO_VERIFIED_SLOT;

  get lastVerifiedSlot(): Slot {
    return this._lastVerifiedSlot;
  }

  set lastVerifiedSlot(slot: Slot) {
    if (slot > this._lastVerifiedSlot) {
      this._lastVerifiedSlot = slot;
    }
  }

  setPreGloasResult(builderDeposit: electra.PendingDeposit, isValid: boolean): void {
    const results = this.preGloasResultsBySlot.getOrDefault(builderDeposit.slot);
    // Hash via PendingDepositNoSlot: slot is already the bucket key, so re-hashing it would
    // be redundant work. PendingDeposit is structurally assignable to PendingDepositNoSlot.
    results.set(toRootHex(ssz.electra.PendingDepositNoSlot.hashTreeRoot(builderDeposit)), isValid);
  }

  setPayloadResult(payloadBlockHash: RootHex, builderDeposit: electra.PendingDepositNoSlot, isValid: boolean): void {
    let results = this.payloadResultsByBlockHash.get(payloadBlockHash);
    if (!results) {
      results = new Map();
      this.payloadResultsByBlockHash.set(payloadBlockHash, results);
    }
    results.set(toRootHex(ssz.electra.PendingDepositNoSlot.hashTreeRoot(builderDeposit)), isValid);
    // Always-prune as the final step. No-op when size ≤ cap (O(1) branch in pruneSetToMax).
    pruneSetToMax(this.payloadResultsByBlockHash, MAX_VERIFIED_PAYLOAD_BLOCK_HASHES);
  }

  getPreGloasResult(builderDeposit: electra.PendingDeposit): boolean | null {
    const results = this.preGloasResultsBySlot.get(builderDeposit.slot);
    if (!results) {
      return null;
    }
    // setPreGloasResult uses PendingDepositNoSlot to hash; mirror here.
    // Map.get returns undefined for missing keys — coalesce to null to honor the contract.
    return results.get(toRootHex(ssz.electra.PendingDepositNoSlot.hashTreeRoot(builderDeposit))) ?? null;
  }

  getPayloadResult(payloadBlockHash: RootHex, builderDeposit: electra.PendingDepositNoSlot): boolean | null {
    const results = this.payloadResultsByBlockHash.get(payloadBlockHash);
    if (!results) {
      return null;
    }
    return results.get(toRootHex(ssz.electra.PendingDepositNoSlot.hashTreeRoot(builderDeposit))) ?? null;
  }

  /**
   * Clears only the pre-Gloas fork-transition slot cache. The payload-blockHash cache is
   * self-rolling via the FIFO cap in setPayloadResult and is intentionally left in place.
   */
  clearPreGloasCache(): void {
    this.preGloasResultsBySlot.clear();
    this._lastVerifiedSlot = NO_VERIFIED_SLOT;
  }
}
