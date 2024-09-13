import {ForkSeq, GENESIS_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStatePhase0,
  EpochTransitionCache,
} from "../types.js";
import {getAttestationDeltas} from "./getAttestationDeltas.js";
import {getRewardsAndPenaltiesAltair} from "./getRewardsAndPenalties.js";

/**
 * This data is reused and never gc.
 */
const balances = new Array<number>();
/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags are set
 */
export function processRewardsAndPenalties(
  state: CachedBeaconStateAllForks,
  cache: EpochTransitionCache,
  slashingPenalties: number[] = []
): void {
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (cache.currentEpoch === GENESIS_EPOCH) {
    return;
  }

  const [rewards, penalties] = getRewardsAndPenalties(state, cache);
  balances.length = state.balances.length;
  state.balances.getAll(balances);

  for (let i = 0, len = rewards.length; i < len; i++) {
    const result = balances[i] + rewards[i] - penalties[i] - (slashingPenalties[i] ?? 0);
    balances[i] = Math.max(result, 0);
  }

  // important: do not change state one balance at a time. Set them all at once, constructing the tree in one go
  // cache the balances array, too
  state.balances = ssz.phase0.Balances.toViewDU(balances, state.epochCtx.balancesTreeCache?.getUnusedBalances());

  // For processEffectiveBalanceUpdates() to prevent having to re-compute the balances array.
  // For validator metrics
  cache.balances = balances;
}

// Note: abstracted in separate function for easier spec tests
export function getRewardsAndPenalties(
  state: CachedBeaconStateAllForks,
  epochTransitionCache: EpochTransitionCache
): [number[], number[]] {
  const fork = state.config.getForkSeq(state.slot);
  return fork === ForkSeq.phase0
    ? getAttestationDeltas(state as CachedBeaconStatePhase0, epochTransitionCache)
    : getRewardsAndPenaltiesAltair(state as CachedBeaconStateAltair, epochTransitionCache);
}
