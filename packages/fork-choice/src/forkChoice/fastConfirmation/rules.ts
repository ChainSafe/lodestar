import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {equalCheckpointWithHex} from "../store.ts";
import {
  FastConfirmationCache,
  FastConfirmationContext,
  FastConfirmationDecision,
  FastConfirmationRule,
  FastConfirmationSnapshot,
  IFastConfirmationStore,
} from "./types.ts";
import {findLatestConfirmedDescendant, getBlock, isAncestor, isConfirmedChainSafe} from "./utils.ts";

export const resetIfConfirmedUnavailable: FastConfirmationRule = (snapshot, ctx, _store, cache, decision) => {
  const confirmedBlock = getBlock(ctx, cache, decision.confirmedRoot);
  if (!confirmedBlock) {
    return {confirmedRoot: snapshot.finalizedRoot, didReset: true, reason: "confirmed_not_found"};
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
    return {confirmedRoot: snapshot.finalizedRoot, didReset, reason: "confirmed_reset"};
  }
  return decision;
};

export const advanceIfObservedJustified: FastConfirmationRule = (snapshot, ctx, store, cache, decision) => {
  if (!isStartSlotOfEpoch(snapshot.currentSlot)) return decision;
  if (store.currentEpochObservedJustifiedCheckpoint.epoch + 1 !== snapshot.currentEpoch) return decision;
  if (!snapshot.headUnrealized) return decision;
  if (!equalCheckpointWithHex(store.currentEpochObservedJustifiedCheckpoint, snapshot.headUnrealized)) return decision;

  const confirmedSlot = getBlock(ctx, cache, decision.confirmedRoot)?.slot ?? null;
  const observedSlot = getBlock(ctx, cache, store.currentEpochObservedJustifiedCheckpoint.rootHex)?.slot ?? null;
  if (confirmedSlot !== null && observedSlot !== null && confirmedSlot < observedSlot) {
    return {
      ...decision,
      confirmedRoot: store.currentEpochObservedJustifiedCheckpoint.rootHex,
      reason: "observed_justified",
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
      reason: "confirmed_descendant",
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

export function runFastConfirmationRules(
  snapshot: FastConfirmationSnapshot,
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  logger?: Logger
): FastConfirmationDecision {
  let decision: FastConfirmationDecision = {confirmedRoot: snapshot.confirmedRoot, didReset: false};

  for (const rule of FAST_CONFIRMATION_RULES) {
    decision = rule(snapshot, ctx, store, cache, decision, logger);
    if (decision.stop) break;
  }
  return decision;
}
