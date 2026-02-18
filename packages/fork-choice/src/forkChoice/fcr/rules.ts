import {isStartSlotOfEpoch} from "@lodestar/state-transition";
import {equalCheckpointWithHex} from "../store.ts";
import {FCRCache, FCRContext, FCRDecision, FCRRule, FCRSnapshot, IFCRStore} from "./types.ts";
import {findLatestConfirmedDescendant, getBlockEpoch, getBlockSlot, isAncestor, isConfirmedChainSafe} from "./utils.ts";

const resetIfConfirmedUnavailable: FCRRule = (snapshot, ctx, _store, cache, decision) => {
  const confirmedEpoch = getBlockEpoch(ctx, cache, decision.confirmedRoot);
  if (confirmedEpoch === null) {
    return {confirmedRoot: snapshot.finalizedRoot, didReset: true, reason: "confirmed_not_found"};
  }
  return decision;
};

const resetIfBehindOrNotAncestorOrUnsafe: FCRRule = (snapshot, ctx, store, cache, decision) => {
  const confirmedEpoch = getBlockEpoch(ctx, cache, decision.confirmedRoot);
  if (confirmedEpoch === null) return decision;

  const confirmedEpochBehindHead = confirmedEpoch + 1 < snapshot.currentEpoch;
  const notAncestorOfHead = !isAncestor(ctx, cache, snapshot.headRoot, decision.confirmedRoot);
  const allChildrenNotConfirmed =
    isStartSlotOfEpoch(snapshot.currentSlot) && !isConfirmedChainSafe(ctx, store, cache, decision.confirmedRoot);

  if (confirmedEpochBehindHead || notAncestorOfHead || allChildrenNotConfirmed) {
    const didReset = decision.didReset || decision.confirmedRoot !== snapshot.finalizedRoot;
    return {confirmedRoot: snapshot.finalizedRoot, didReset, reason: "confirmed_reset"};
  }
  return decision;
};

const advanceIfObservedJustified: FCRRule = (snapshot, ctx, store, cache, decision) => {
  if (!isStartSlotOfEpoch(snapshot.currentSlot)) return decision;
  if (store.currentEpochObservedJustifiedCheckpoint.epoch + 1 !== snapshot.currentEpoch) return decision;
  if (!snapshot.headUnrealized) return decision;
  if (!equalCheckpointWithHex(store.currentEpochObservedJustifiedCheckpoint, snapshot.headUnrealized)) return decision;

  const confirmedSlot = getBlockSlot(ctx, cache, decision.confirmedRoot);
  const observedSlot = getBlockSlot(ctx, cache, store.currentEpochObservedJustifiedCheckpoint.rootHex);
  if (confirmedSlot !== null && observedSlot !== null && confirmedSlot < observedSlot) {
    return {
      ...decision,
      confirmedRoot: store.currentEpochObservedJustifiedCheckpoint.rootHex,
      reason: "observed_justified",
    };
  }
  return decision;
};

const advanceToLatestConfirmedDescendant: FCRRule = (snapshot, ctx, store, cache, decision) => {
  const confirmedEpoch = getBlockEpoch(ctx, cache, decision.confirmedRoot);
  if (confirmedEpoch !== null && confirmedEpoch + 1 >= snapshot.currentEpoch) {
    const newConfirmed = findLatestConfirmedDescendant(snapshot, ctx, store, cache, decision.confirmedRoot);
    return {
      ...decision,
      confirmedRoot: newConfirmed,
      reason: "confirmed_descendant",
    };
  }
  return decision;
};

const FCR_RULES: FCRRule[] = [
  resetIfConfirmedUnavailable,
  resetIfBehindOrNotAncestorOrUnsafe,
  advanceIfObservedJustified,
  advanceToLatestConfirmedDescendant,
];

export function runFCRRules(snapshot: FCRSnapshot, ctx: FCRContext, store: IFCRStore, cache: FCRCache): FCRDecision {
  let decision: FCRDecision = {confirmedRoot: snapshot.confirmedRoot, didReset: false};

  for (const rule of FCR_RULES) {
    decision = rule(snapshot, ctx, store, cache, decision);
    if (decision.stop) break;
  }
  return decision;
}
