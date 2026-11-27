import {PubkeyHex, electra} from "@lodestar/types";

/**
 * Caches deposit signature-verification results — passes (`true`) and failures (`false`) — so the
 * Fulu → Gloas fork transition can skip the bulk verification cost AND skip re-verifying deposits
 * already proven invalid. Covers both builder-prefix deposits (onboarding) and validator deposits
 * that share a pubkey with a builder deposit (the ones `hasPendingValidator` checks at the fork).
 *
 * Keyed by the deposit's struct **value object** — `electra.PendingDeposit` is a
 * `ContainerNodeStructType`, so its `node.value` is a stable object reused across
 * prepareNextSlot-derived states and carried by reference through the gloas pendingDeposits
 * migration. No merkle-root computation, no slot bucketing.
 *
 * Also tracks builder pubkeys seen so the scanner knows which validator deposits to pre-verify (only
 * those sharing a pubkey with a builder deposit ever reach `hasPendingValidator`). The mapped boolean
 * records whether a *valid* validator deposit for that pubkey has been found: once true, the scanner
 * stops pre-verifying further validator deposits for it — `hasPendingValidator` short-circuits on the
 * first valid signature at the fork, so the rest would never be read.
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
  /** builder pubkey → whether a valid validator deposit sharing it has already been pre-verified. */
  private builderPubkeys = new Map<PubkeyHex, boolean>();

  setSignatureValidity(deposit: electra.PendingDeposit, isValid: boolean): void {
    this.validityByDeposit.set(deposit, isValid);
  }

  getSignatureValidity(deposit: electra.PendingDeposit): boolean | null {
    return this.validityByDeposit.get(deposit) ?? null;
  }

  isVerified(deposit: electra.PendingDeposit): boolean {
    return this.validityByDeposit.has(deposit);
  }

  /** Record a builder deposit's pubkey so the scanner pre-verifies validator deposits for it.
   *  Idempotent; never downgrades a pubkey already marked as having a valid validator deposit. */
  addBuilderPubkey(pubkeyHex: PubkeyHex): void {
    if (!this.builderPubkeys.has(pubkeyHex)) {
      this.builderPubkeys.set(pubkeyHex, false);
    }
  }

  isBuilderPubkey(pubkeyHex: PubkeyHex): boolean {
    return this.builderPubkeys.has(pubkeyHex);
  }

  /** True once a valid validator deposit sharing this builder pubkey has been pre-verified — the
   *  scanner then skips this pubkey's remaining validator deposits (as `hasPendingValidator` would). */
  hasValidValidatorDeposit(pubkeyHex: PubkeyHex): boolean {
    return this.builderPubkeys.get(pubkeyHex) === true;
  }

  /** Mark that a valid validator deposit sharing this builder pubkey was found. */
  setValidValidatorDeposit(pubkeyHex: PubkeyHex): void {
    this.builderPubkeys.set(pubkeyHex, true);
  }

  /** Cumulative deposits verified & cached this window (pass + fail). */
  get cachedDepositCount(): number {
    return this.validityByDeposit.size;
  }

  /** Distinct builder pubkeys tracked this window. */
  get builderPubkeyCount(): number {
    return this.builderPubkeys.size;
  }

  clear(): void {
    this.validityByDeposit.clear();
    this.builderPubkeys.clear();
  }
}
