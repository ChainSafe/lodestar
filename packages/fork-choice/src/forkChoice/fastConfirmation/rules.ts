import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {equalCheckpointWithHex} from "../store.ts";
import {
  FastConfirmationCache,
  FastConfirmationContext,
  FastConfirmationDecision,
  FastConfirmationDecisionReason,
  FastConfirmationRule,
  FastConfirmationRunResult,
  FastConfirmationSnapshot,
  IFastConfirmationStore,
} from "./types.ts";
import {findLatestConfirmedDescendant, getBlock, isAncestor, isConfirmedChainSafe} from "./utils.ts";

export const resetIfConfirmedUnavailable: FastConfirmationRule = (snapshot, ctx, _store, cache, decision) => {
  const confirmedBlock = getBlock(ctx, cache, decision.confirmedRoot);
  if (!confirmedBlock) {
    return {
      confirmedRoot: snapshot.finalizedRoot,
      didReset: true,
      reason: FastConfirmationDecisionReason.ConfirmedNotFound,
    };
  }
  return decision;
};

export const resetIfBehindOrNotAncestorOrUnsafe: FastConfirmationRule = (
  snapshot,
  ctx,
  store,
  cache,
  decision,
  logger
) => {
  const confirmedBlock = getBlock(ctx, cache, decision.confirmedRoot);
  if (!confirmedBlock) return decision;
  const confirmedEpoch = computeEpochAtSlot(confirmedBlock.slot);

  const confirmedEpochBehindHead = confirmedEpoch + 1 < snapshot.currentEpoch;
  const notAncestorOfHead = !isAncestor(ctx, cache, snapshot.headRoot, decision.confirmedRoot);
  const allChildrenNotConfirmed =
    isStartSlotOfEpoch(snapshot.currentSlot) &&
    !isConfirmedChainSafe(ctx, store, cache, decision.confirmedRoot, logger);

  if (confirmedEpochBehindHead || notAncestorOfHead || allChildrenNotConfirmed) {
    const didReset = decision.didReset || decision.confirmedRoot !== snapshot.finalizedRoot;
    const reason = confirmedEpochBehindHead
      ? FastConfirmationDecisionReason.ResetBehind
      : notAncestorOfHead
        ? FastConfirmationDecisionReason.ResetNotAncestor
        : FastConfirmationDecisionReason.ResetChainUnsafe;
    return {confirmedRoot: snapshot.finalizedRoot, didReset, reason};
  }
  return decision;
};

export const advanceIfObservedJustified: FastConfirmationRule = (snapshot, ctx, store, cache, decision) => {
  if (!isStartSlotOfEpoch(snapshot.currentSlot)) return decision;
  if (store.currentEpochObservedJustifiedCheckpoint.epoch + 1 !== snapshot.currentEpoch) return decision;
  if (!snapshot.headUnrealized) return decision;
  if (!equalCheckpointWithHex(store.currentEpochObservedJustifiedCheckpoint, snapshot.headUnrealized)) return decision;
  const observedBlock = getBlock(ctx, cache, store.currentEpochObservedJustifiedCheckpoint.rootHex);
  if (!observedBlock || computeEpochAtSlot(observedBlock.slot) + 1 < snapshot.currentEpoch) return decision;

  const confirmedSlot = getBlock(ctx, cache, decision.confirmedRoot)?.slot ?? null;
  const observedSlot = observedBlock.slot;
  if (confirmedSlot !== null && observedSlot !== null && confirmedSlot < observedSlot) {
    return {
      ...decision,
      confirmedRoot: store.currentEpochObservedJustifiedCheckpoint.rootHex,
      reason: FastConfirmationDecisionReason.ObservedJustified,
    };
  }
  return decision;
};

export const advanceToLatestConfirmedDescendant: FastConfirmationRule = (
  snapshot,
  ctx,
  store,
  cache,
  decision,
  logger
) => {
  const confirmedBlock = getBlock(ctx, cache, decision.confirmedRoot);
  const confirmedEpoch = confirmedBlock ? computeEpochAtSlot(confirmedBlock.slot) : null;
  if (confirmedEpoch !== null && confirmedEpoch + 1 >= snapshot.currentEpoch) {
    const newConfirmed = findLatestConfirmedDescendant(snapshot, ctx, store, cache, decision.confirmedRoot, logger);
    return {
      ...decision,
      confirmedRoot: newConfirmed,
      reason: FastConfirmationDecisionReason.ConfirmedDescendant,
    };
  }
  return decision;
};

export const FAST_CONFIRMATION_RULES: FastConfirmationRule[] = [
  resetIfConfirmedUnavailable,
  resetIfBehindOrNotAncestorOrUnsafe,
  advanceIfObservedJustified,
  advanceToLatestConfirmedDescendant,
];

// Spec mapping: this rule runner implements the `get_latest_confirmed` decision flow
// over Lodestar's snapshot/store/cache abstractions.
export function runFastConfirmationRules(
  snapshot: FastConfirmationSnapshot,
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  logger?: Logger
): FastConfirmationRunResult {
  let decision: FastConfirmationDecision = {
    confirmedRoot: snapshot.confirmedRoot,
    didReset: false,
    reason: FastConfirmationDecisionReason.Unchanged,
  };

  // Track every reason a rule decided on, the final `decision.reason` is overwritten by
  // later rules (eg. a restart is followed by advancing to the latest confirmed descendant)
  const reasons = new Set<FastConfirmationDecisionReason>();
  for (const rule of FAST_CONFIRMATION_RULES) {
    decision = rule(snapshot, ctx, store, cache, decision, logger);
    reasons.add(decision.reason);
  }

  return {
    confirmedRoot: decision.confirmedRoot,
    didReset: decision.didReset,
    reason: decision.reason,
    didReorg: reasons.has(FastConfirmationDecisionReason.ResetNotAncestor),
    didRestart: reasons.has(FastConfirmationDecisionReason.ObservedJustified),
  };
}
