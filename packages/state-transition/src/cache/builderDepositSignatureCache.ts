import {electra} from "@lodestar/types";

/**
 * Caches builder-deposit signature-verification results — passes (`true`) and failures (`false`)
 * — so the Fulu → Gloas fork transition can skip the bulk verification cost AND skip re-verifying
 * deposits already proven invalid.
 *
 * Keyed by the deposit's struct **value object** — `electra.PendingDeposit` is a
 * `ContainerNodeStructType`, so its `node.value` is a stable object reused across
 * prepareNextSlot-derived states and carried by reference through the gloas pendingDeposits
 * migration. No merkle-root computation, no slot bucketing.
 *
 * Lifecycle owned by `prepareNextSlot`: filled during the pre-fork window, then `clear()`ed once the
 * Gloas fork is finalized. `onboardBuildersFromPendingDeposits()` only reads it. A plain `Map` (not a
 * `WeakMap`) is used so the drop is deterministic and the contents are inspectable for logging.
 *
 * Single instance across the application (created in `EpochCache.createFromState`, shared
 * by-reference through `clone()`).
 */
export class BuilderDepositSignatureCache {
  private validityByDeposit = new Map<electra.PendingDeposit, boolean>();

  setSignatureValidity(deposit: electra.PendingDeposit, isValid: boolean): void {
    this.validityByDeposit.set(deposit, isValid);
  }

  getSignatureValidity(deposit: electra.PendingDeposit): boolean | null {
    return this.validityByDeposit.get(deposit) ?? null;
  }

  isVerified(deposit: electra.PendingDeposit): boolean {
    return this.validityByDeposit.has(deposit);
  }

  /** Cumulative builder deposits verified & cached this window (pass + fail). */
  get size(): number {
    return this.validityByDeposit.size;
  }

  clear(): void {
    this.validityByDeposit.clear();
  }
}
