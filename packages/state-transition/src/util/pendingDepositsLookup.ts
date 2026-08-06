import {BeaconConfig} from "@lodestar/config";
import {PubkeyHex, electra} from "@lodestar/types";
import {isValidDepositSignature} from "../block/processDeposit.js";
import {BuilderDepositSignatureCache} from "../cache/builderDepositSignatureCache.js";

type PendingDepositsValidation = {
  hasValidSignature: boolean;
  validatedCount: number;
};

/**
 * Mutable lookup for the pending-deposit sequence used by builder-routing logic.
 *
 * This is to implement the spec's `is_pending_validator(pending_deposits, pubkey)` lazily:
 * deposits are grouped by pubkey without verifying signatures, and BLS verification is
 * deferred until a builder deposit needs to know whether the same pubkey already has a
 * valid pending validator deposit.
 *
 * Call `add()` whenever a deposit is appended to the represented sequence. A cached `true`
 * result short-circuits all subsequent checks for that pubkey; a cached `false` records
 * how many deposits were already verified, so appending a new deposit only verifies the
 * newly-appended tail rather than re-running BLS on previously-invalid entries.
 */
export class PendingDepositsLookup {
  private constructor(
    private readonly depositsByPubkey: Map<PubkeyHex, electra.PendingDeposit[]>,
    private readonly validationCache: Map<PubkeyHex, PendingDepositsValidation>
  ) {}

  /** Build an empty lookup for a sequence that will be populated incrementally. */
  static buildEmpty(): PendingDepositsLookup {
    return new PendingDepositsLookup(new Map(), new Map());
  }

  /**
   * Append a pending deposit to the represented sequence, keyed by its (precomputed) `pubkeyHex`.
   */
  add(pendingDeposit: electra.PendingDeposit, pubkeyHex: PubkeyHex): void {
    const existing = this.depositsByPubkey.get(pubkeyHex);
    if (existing) {
      existing.push(pendingDeposit);
    } else {
      this.depositsByPubkey.set(pubkeyHex, [pendingDeposit]);
    }
  }

  /**
   * Returns true if any pending deposit for `pubkeyHex` has a valid BLS deposit signature.
   * Memoizes the result in `validationCache` so repeated checks for the same pubkey
   * within a block only verify deposits that have not already been checked.
   *
   * Most of the time it should hit the BuilderDepositSignatureCache so we don't have to validate
   * signatures here.
   */
  hasPendingValidator(config: BeaconConfig, pubkeyHex: PubkeyHex, cache: BuilderDepositSignatureCache): boolean {
    const validation = this.validationCache.get(pubkeyHex);
    if (validation?.hasValidSignature === true) {
      return true;
    }

    const deposits = this.depositsByPubkey.get(pubkeyHex);
    if (deposits === undefined) {
      return false;
    }

    // hasValidSignature is false or undefined; resume from the last validatedCount so
    // previously-checked invalid deposits are not re-verified.
    const startIndex = validation?.validatedCount ?? 0;
    if (startIndex === deposits.length) {
      // Nothing new to check; the cached false result still holds.
      return false;
    }

    for (let i = startIndex; i < deposits.length; i++) {
      const deposit = deposits[i];
      const isValid =
        cache.getSignatureValidity(deposit) ??
        isValidDepositSignature(
          config,
          deposit.pubkey,
          deposit.withdrawalCredentials,
          deposit.amount,
          deposit.signature
        );
      if (isValid) {
        this.validationCache.set(pubkeyHex, {hasValidSignature: true, validatedCount: i + 1});
        return true;
      }
    }

    this.validationCache.set(pubkeyHex, {hasValidSignature: false, validatedCount: deposits.length});
    return false;
  }
}
