import {RootHex, Slot, electra, ssz} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";

/**
 * Caches pre-verified builder-deposit signatures so the Fulu → Gloas fork
 * transition can skip the bulk verification cost.
 *
 * Lifecycle:
 * - Producer: `preVerifyBuilderDeposits()` driven by `prepareForNextSlot`
 *   over the 2 epochs leading up to GLOAS_FORK_EPOCH.
 * - Consumer: `onboardBuildersFromPendingDeposits()` (upgradeStateToGloas)
 *   checks each candidate deposit against the cache, taking the
 *   pre-verified fast path when hit.
 * - Disposer: `clear()` is called from `prepareForNextSlot` once the
 *   finalized epoch reaches GLOAS_FORK_EPOCH — at that point no further
 *   Gloas transitions can occur on any fork.
 *
 * Membership key is `hashTreeRoot(PendingDeposit)` which covers
 * (pubkey, withdrawalCredentials, amount, signature, slot) — byte-identical
 * deposits in any fork's pendingDeposits look up correctly.
 *
 * Single instance across application (created in `EpochCache.createFromState`,
 * shared by-reference through `clone()`).
 */
export class GloaOnboardBuilderCache {
  private verifiedRootsBySlot: MapDef<Slot, Set<RootHex>> = new MapDef(() => new Set());
  private _lastVerifiedSlot: Slot = 0;

  get lastVerifiedSlot(): Slot {
    return this._lastVerifiedSlot;
  }

  set lastVerifiedSlot(slot: Slot) {
    if (slot > this._lastVerifiedSlot) {
      this._lastVerifiedSlot = slot;
    }
  }

  setVerifiedDeposit(deposit: electra.PendingDeposit): void {
    const verifiedRoots = this.verifiedRootsBySlot.getOrDefault(deposit.slot);
    verifiedRoots.add(toRootHex(ssz.electra.PendingDeposit.hashTreeRoot(deposit)));
  }

  isBuilderDepositVerified(deposit: electra.PendingDeposit): boolean {
    const verifiedRoots = this.verifiedRootsBySlot.get(deposit.slot);
    if (!verifiedRoots) {
      return false;
    }
    return verifiedRoots.has(toRootHex(ssz.electra.PendingDeposit.hashTreeRoot(deposit)));
  }

  clear(): void {
    this.verifiedRootsBySlot.clear();
    this._lastVerifiedSlot = 0;
  }
}
