import {MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStatePq, EpochTransitionCache} from "../types.js";
import {computeEpochShuffling} from "../util/epochShuffling.js";
import {computeAggregationCommitteesForEpoch} from "../util/pq.js";

/** Shifts the window of aggregation committees by an epoch and fills in the last one */
export function processAggregationCommitteeWindow(state: CachedBeaconStatePq, cache: EpochTransitionCache): void {
  const nextEpoch = state.epochCtx.epoch + MIN_SEED_LOOKAHEAD + 1;
  const shuffling = cache.nextShuffling ?? computeEpochShuffling(state, cache.nextShufflingActiveIndices, nextEpoch);
  cache.nextShuffling = shuffling;
  const committees = computeAggregationCommitteesForEpoch(
    state,
    nextEpoch,
    shuffling.committees,
    state.epochCtx.effectiveBalanceIncrements
  );

  const window = state.aggregationCommitteeWindow;
  const retainedLength = window.length - SLOTS_PER_EPOCH;
  for (let i = 0; i < retainedLength; i++) {
    window.set(i, window.getReadonly(i + SLOTS_PER_EPOCH));
  }
  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    window.set(retainedLength + i, ssz.pq.AggregationCommittees.toViewDU(committees[i]));
  }
}
