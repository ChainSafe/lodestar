import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {equalCheckpointWithHex} from "../store.ts";
import {
  FastConfirmationCache,
  FastConfirmationContext,
  FastConfirmationDecision,
  FastConfirmationDecisionReason,
  FastConfirmationRule,
  FastConfirmationSnapshot,
  IFastConfirmationStore,
} from "./types.ts";
import {findLatestConfirmedDescendant, getBlock, isAncestor} from "./utils.ts";

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

export const resetIfBehindOrNotAncestorOrUnsafe: FastConfirmationRule = (snapshot, ctx, _store, cache, decision) => {
  const confirmedBlock = getBlock(ctx, cache, decision.confirmedRoot);
  if (!confirmedBlock) return decision;
  const confirmedEpoch = computeEpochAtSlot(confirmedBlock.slot);

  const confirmedEpochBehindHead = confirmedEpoch + 1 < snapshot.currentEpoch;
  const notAncestorOfHead = !isAncestor(ctx, cache, snapshot.headRoot, decision.confirmedRoot);

  if (confirmedEpochBehindHead || notAncestorOfHead) {
    const didReset = decision.didReset || decision.confirmedRoot !== snapshot.finalizedRoot;
    const reason = confirmedEpochBehindHead
      ? FastConfirmationDecisionReason.ResetBehind
      : FastConfirmationDecisionReason.ResetNotAncestor;
    return {confirmedRoot: snapshot.finalizedRoot, didReset, reason};
  }

  // Monotonicity guard (proposal — see the PR description and the open spec question).
  // A confirmed block that is still a canonical ancestor of head and within range has NOT been
  // reverted, so it must not be released by the epoch-boundary chain-safety re-check. That re-check
  // re-derives is_one_confirmed from the live vote view, which can be transiently stale (e.g. the most
  // recent slot's attestations not yet processed at the boundary) and spuriously fail for a block that
  // was validly confirmed and is still canonical. Only an actual reorg (not an ancestor of head) or
  // staleness (more than one epoch behind head) releases the confirmed marker, so the expensive
  // is_confirmed_chain_safe re-check is no longer run here (it would only drive a debug log).
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
): FastConfirmationDecision {
  let decision: FastConfirmationDecision = {
    confirmedRoot: snapshot.confirmedRoot,
    didReset: false,
    reason: FastConfirmationDecisionReason.Unchanged,
  };

  for (const rule of FAST_CONFIRMATION_RULES) {
    decision = rule(snapshot, ctx, store, cache, decision, logger);
  }
  return decision;
}
