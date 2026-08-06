import {electra} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {verifyDepositSignatures} from "../block/processDeposit.js";
import {CachedBeaconStateFulu} from "../types.js";
import {isBuilderWithdrawalCredential} from "./gloas.js";

/** Verify queued deposit signatures in batches of this size. Also the time-box granularity: the
 *  deadline is checked once per batch, so overrun is bounded to a single batch. Exported for tests. */
export const BUILDER_DEPOSIT_BATCH_SIZE = 32;

/**
 * Per-tick cap on builder deposits the prepareForNextSlot scanner will verify.
 * ~2.7s for 10_000 BLS verifications on a typical server — fits within the slot budget while the
 * pre-window (see GLOAS_PREVERIFY_WINDOW_EPOCHS) covers up to ~620k deposits over its duration.
 */
export const MAX_BUILDER_DEPOSITS_PER_SLOT = 10_000;

/**
 * Number of epochs before GLOAS_FORK_EPOCH during which the prepareForNextSlot scanner pre-verifies
 * builder-deposit signatures. Two: deposits arriving this late cannot collude with validator
 * deposits — validator-vs-builder routing is decided at the fork boundary from what is already in
 * pendingDeposits, so anything submitted inside this window is unambiguous.
 */
export const GLOAS_PREVERIFY_WINDOW_EPOCHS = 2;

/**
 * Summary of a single `preVerifyBuilderDepositsPreGloas` call.
 */
export type PreVerifyBuilderDepositsResult = {
  /** Builder-prefix deposit signatures verified valid in this call (cached true). */
  validBuilderSignaturesCount: number;
  /** Builder-prefix deposit signatures verified invalid in this call (cached false, dropped at fork). */
  invalidBuilderSignaturesCount: number;
  /** Validator (builder-pubkey) deposit signatures verified valid in this call. */
  validValidatorSignaturesCount: number;
  /** Validator (builder-pubkey) deposit signatures verified invalid in this call (abuse signal). */
  invalidValidatorSignaturesCount: number;
  /** Pending deposits examined this call (all creds; < pendingDepositsCount ⇒ per-tick cap hit). */
  scannedPendingDeposits: number;
  /** Cumulative deposits verified & cached so far this window (cache size, pass + fail). */
  totalCachedDeposits: number;
  /** Distinct builder pubkeys tracked so far this window. */
  totalBuilderPubkeys: number;
  /** Current `state.pendingDeposits.length` — the full backlog. */
  pendingDepositsCount: number;
};

/**
 * Scanner driven by `prepareForNextSlot` over the `GLOAS_PREVERIFY_WINDOW_EPOCHS` epochs before
 * GLOAS_FORK_EPOCH. Walks `state.pendingDeposits` (as struct values via getAllReadonlyValues) and
 * queues, for signature verification, the deposits the fork transition will check on its hot path:
 *   - builder-prefix deposits (for onboarding); records each builder pubkey on the cache, and
 *   - validator deposits sharing a builder pubkey (the set `hasPendingValidator` walks at the fork),
 *     but only until one is found valid — `hasPendingValidator` stops at the first valid signature, so
 *     the cache marks the pubkey and the scanner skips that pubkey's remaining validator deposits.
 *
 * Bounded by two knobs: at most `maxBuilderDeposits` new deposits are queued per call, and the chunk
 * verification is **time-boxed** to `maxDurationMs`.
 */
export function preVerifyBuilderDepositsPreGloas(
  state: CachedBeaconStateFulu,
  maxBuilderDeposits: number,
  maxDurationMs: number
): PreVerifyBuilderDepositsResult {
  const cache = state.epochCtx.builderDepositSignatureCache;

  // Collect uncached deposits to verify as struct values. Full rescan each tick: iteration is
  // O(pendingDeposits) but runs in prepareNextSlot spare time, and isVerified() is an O(1) skip for
  // already-cached deposits. For a ContainerNodeStructType, getAllReadonlyValues() returns each
  // node.value by reference — the stable cache key.
  const queue: electra.PendingDeposit[] = [];
  let scannedPendingDeposits = 0;
  for (const deposit of state.pendingDeposits.getAllReadonlyValues()) {
    if (queue.length >= maxBuilderDeposits) break; // per-tick cap; next tick resumes via isVerified()
    scannedPendingDeposits++;
    if (cache.isVerified(deposit)) continue; // already verified in an earlier tick

    if (isBuilderWithdrawalCredential(deposit.withdrawalCredentials)) {
      // Record the builder pubkey so validator deposits sharing it get pre-verified — this or a
      // later tick, since those validator deposits precede the builder deposit in the queue. A cached
      // builder deposit already added its pubkey, so it's safe to skip via the `continue` above.
      cache.addBuilderPubkey(toPubkeyHex(deposit.pubkey));
      queue.push(deposit);
    } else {
      // Validator deposit — pre-verify only if it shares a builder pubkey (the set hasPendingValidator
      // walks at the fork) AND we haven't already cached a valid validator deposit for that pubkey.
      // this is the same logic to hasPendingValidator.
      const pubkeyHex = toPubkeyHex(deposit.pubkey);
      if (cache.isBuilderPubkey(pubkeyHex) && !cache.hasValidValidatorDeposit(pubkeyHex)) {
        queue.push(deposit);
      }
    }
  }

  const pendingDepositsCount = state.pendingDeposits.length;
  if (queue.length === 0) {
    return {
      validBuilderSignaturesCount: 0,
      invalidBuilderSignaturesCount: 0,
      validValidatorSignaturesCount: 0,
      invalidValidatorSignaturesCount: 0,
      scannedPendingDeposits,
      totalCachedDeposits: cache.cachedDepositCount,
      totalBuilderPubkeys: cache.builderPubkeyCount,
      pendingDepositsCount,
    };
  }

  // Verify in chunks; chunking caps the fallback blast radius so one bad signature only forces 32
  // individual re-verifications. Key each result by the deposit value object. Counts are tracked
  // incrementally (not queue.length - verified) so they stay correct when we time-box out early.
  const deadline = Date.now() + maxDurationMs;
  let validBuilderSignaturesCount = 0;
  let invalidBuilderSignaturesCount = 0;
  let validValidatorSignaturesCount = 0;
  let invalidValidatorSignaturesCount = 0;
  for (let chunkStart = 0; chunkStart < queue.length; chunkStart += BUILDER_DEPOSIT_BATCH_SIZE) {
    const end = Math.min(chunkStart + BUILDER_DEPOSIT_BATCH_SIZE, queue.length);
    const chunk = queue.slice(chunkStart, end);
    const chunkResults = verifyDepositSignatures(state.epochCtx.config, chunk);
    for (let j = 0; j < chunk.length; j++) {
      cache.setSignatureValidity(chunk[j], chunkResults[j]);
      const isBuilder = isBuilderWithdrawalCredential(chunk[j].withdrawalCredentials);
      if (chunkResults[j]) {
        if (isBuilder) {
          validBuilderSignaturesCount++;
        } else {
          validValidatorSignaturesCount++;
          // A valid validator deposit satisfies hasPendingValidator() for this pubkey; stop
          // pre-verifying its remaining validator deposits on later ticks.
          cache.setValidValidatorDeposit(toPubkeyHex(chunk[j].pubkey));
        }
      } else if (isBuilder) {
        invalidBuilderSignaturesCount++;
      } else {
        invalidValidatorSignaturesCount++;
      }
    }
    // Time-box: keep everything verified so far (already cached) and stop
    if (Date.now() >= deadline) break;
  }

  return {
    validBuilderSignaturesCount,
    invalidBuilderSignaturesCount,
    validValidatorSignaturesCount,
    invalidValidatorSignaturesCount,
    scannedPendingDeposits,
    totalCachedDeposits: cache.cachedDepositCount,
    totalBuilderPubkeys: cache.builderPubkeyCount,
    pendingDepositsCount,
  };
}
