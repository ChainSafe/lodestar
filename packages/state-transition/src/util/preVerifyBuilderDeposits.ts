import {electra} from "@lodestar/types";
import {verifyDepositSignatures} from "../block/processDeposit.js";
import {CachedBeaconStateFulu} from "../types.js";
import {isBuilderWithdrawalCredential} from "./gloas.js";

/** Verify queued builder deposit signatures in batches of this size. */
const BUILDER_DEPOSIT_BATCH_SIZE = 32;

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

/** Summary of a single `preVerifyBuilderDepositsPreGloas` call. */
export type PreVerifyBuilderDepositsResult = {
  /** Builder deposits whose signatures passed verification in THIS call (cached true). */
  verifiedBuildersCount: number;
  /**
   * Builder deposits whose signatures failed in THIS call (cached false; the fork-transition path
   * drops them). Non-zero is worth surfacing — legitimate deposits should not have invalid
   * signatures, so a spike likely indicates abuse.
   */
  invalidBuildersCount: number;
  /** Pending deposits examined this call (all creds; < pendingDepositsCount ⇒ per-tick cap hit). */
  scannedPendingDeposits: number;
  /** Cumulative builder deposits verified & cached so far this window (cache size, pass + fail). */
  totalBuildersVerified: number;
  /** Current `state.pendingDeposits.length` — the full backlog. */
  pendingDepositsCount: number;
};

/**
 * Scanner driven by `prepareForNextSlot` over the `GLOAS_PREVERIFY_WINDOW_EPOCHS` epochs before
 * GLOAS_FORK_EPOCH. Walks `state.pendingDeposits` (as struct values via getAllReadonlyValues),
 * selects builder-prefix deposits (a cheap credential check that filters out the validator-deposit
 * majority first), skips those already cached (by value-object identity), and signature-verifies the
 * rest in BUILDER_DEPOSIT_BATCH_SIZE chunks, stashing each result on `builderDepositSignatureCache`
 * keyed by the value object.
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

  // Collect uncached builder-prefix deposits as struct values. Full rescan each tick: iteration is
  // O(pendingDeposits) but runs in prepareNextSlot spare time; the credential check short-circuits
  // the validator-deposit majority and isVerified() is an O(1) skip for already-cached builders, so
  // a "nothing new" rescan is cheap. For a ContainerNodeStructType, getAllReadonlyValues() returns
  // each node.value by reference — the stable cache key.
  const queue: electra.PendingDeposit[] = [];
  let scannedPendingDeposits = 0;
  for (const deposit of state.pendingDeposits.getAllReadonlyValues()) {
    if (queue.length >= maxBuilderDeposits) break; // per-tick cap; next tick resumes via isVerified()
    scannedPendingDeposits++;
    // Cheap credential prefix check first: most pending deposits are validator (non-builder)
    // deposits, so this short-circuits the majority before any cache lookup. Only builder deposits
    // are ever cached, so isVerified() is only meaningful past this filter.
    if (!isBuilderWithdrawalCredential(deposit.withdrawalCredentials)) continue;
    if (cache.isVerified(deposit)) continue; // verified in an earlier tick

    queue.push(deposit);
  }

  const pendingDepositsCount = state.pendingDeposits.length;
  if (queue.length === 0) {
    return {
      verifiedBuildersCount: 0,
      invalidBuildersCount: 0,
      scannedPendingDeposits,
      totalBuildersVerified: cache.size,
      pendingDepositsCount,
    };
  }

  // Verify in chunks; chunking caps the fallback blast radius so one bad signature only forces 32
  // individual re-verifications. Key each result by the deposit value object. Track invalid count
  // incrementally (not queue.length - verified) so it stays correct when we time-box out early.
  const deadline = Date.now() + maxDurationMs;
  let verifiedBuildersCount = 0;
  let invalidBuildersCount = 0;
  for (let chunkStart = 0; chunkStart < queue.length; chunkStart += BUILDER_DEPOSIT_BATCH_SIZE) {
    const end = Math.min(chunkStart + BUILDER_DEPOSIT_BATCH_SIZE, queue.length);
    const chunk = queue.slice(chunkStart, end);
    const chunkResults = verifyDepositSignatures(state.epochCtx.config, chunk);
    for (let j = 0; j < chunk.length; j++) {
      cache.setSignatureValidity(chunk[j], chunkResults[j]);
      if (chunkResults[j]) verifiedBuildersCount++;
      else invalidBuildersCount++;
    }
    // Time-box: keep everything verified so far (already cached) and stop
    if (Date.now() >= deadline) break;
  }

  return {
    verifiedBuildersCount,
    invalidBuildersCount,
    scannedPendingDeposits,
    totalBuildersVerified: cache.size,
    pendingDepositsCount,
  };
}
