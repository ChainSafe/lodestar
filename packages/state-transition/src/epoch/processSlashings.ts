import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  PROPORTIONAL_SLASHING_MULTIPLIER,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR,
  PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX,
} from "@lodestar/params";

import {decreaseBalance} from "../util/index.js";
import {BeaconStateAllForks, CachedBeaconStateAllForks, EpochTransitionCache} from "../types.js";

/**
 * Update validator registry for validators that activate + exit
 * updateBalance is an optimization:
 * - For spec test, it's true
 * - For processEpoch flow, it's false, i.e to only update balances once in processRewardsAndPenalties()
 *
 * PERF: almost no (constant) cost.
 * - Total slashings by increment is computed once and stored in state.epochCtx.totalSlashingsByIncrement so no need to compute here
 * - Penalties for validators with the same effective balance are the same and computed once
 * - No need to apply penalties to validators here, do it once in processRewardsAndPenalties()
 * - indicesToSlash: max len is 8704. But it's very unlikely since it would require all validators on the same
 *   committees to sign slashable attestations.
 * - On normal mainnet conditions indicesToSlash = 0
 *
 * @returns slashing penalties to be applied in processRewardsAndPenalties()
 */
export function processSlashings(
  state: CachedBeaconStateAllForks,
  cache: EpochTransitionCache,
  updateBalance = true
): number[] {
  // Return early if there no index to slash
  if (cache.indicesToSlash.length === 0) {
    return [];
  }

  const totalBalanceByIncrement = cache.totalActiveStakeByIncrement;
  const fork = state.config.getForkSeq(state.slot);
  const proportionalSlashingMultiplier =
    fork === ForkSeq.phase0
      ? PROPORTIONAL_SLASHING_MULTIPLIER
      : fork === ForkSeq.altair
        ? PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR
        : PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX;

  const {effectiveBalanceIncrements} = state.epochCtx;
  const adjustedTotalSlashingBalanceByIncrement = Math.min(
    state.epochCtx.totalSlashingsByIncrement * proportionalSlashingMultiplier,
    totalBalanceByIncrement
  );
  const increment = EFFECTIVE_BALANCE_INCREMENT;

  const penaltyPerEffectiveBalanceIncrement = Math.floor(
    (adjustedTotalSlashingBalanceByIncrement * increment) / totalBalanceByIncrement
  );
  const penalties: number[] = [];

  const penaltiesByEffectiveBalanceIncrement = new Map<number, number>();
  for (const index of cache.indicesToSlash) {
    const effectiveBalanceIncrement = effectiveBalanceIncrements[index];
    let penalty = penaltiesByEffectiveBalanceIncrement.get(effectiveBalanceIncrement);
    if (penalty === undefined) {
      if (fork < ForkSeq.electra) {
        const penaltyNumeratorByIncrement = effectiveBalanceIncrement * adjustedTotalSlashingBalanceByIncrement;
        penalty = Math.floor(penaltyNumeratorByIncrement / totalBalanceByIncrement) * increment;
      } else {
        penalty = penaltyPerEffectiveBalanceIncrement * effectiveBalanceIncrement;
      }
      penaltiesByEffectiveBalanceIncrement.set(effectiveBalanceIncrement, penalty);
    }

    if (updateBalance) {
      // for spec test only
      decreaseBalance(state, index, penalty);
    } else {
      // do it later in processRewardsAndPenalties()
      penalties[index] = penalty;
    }
  }

  return penalties;
}

/**
 * Get total slashings by increment.
 * By default, total slashings are computed every time we run processSlashings() function above.
 * We improve it by computing it once and store it in state.epochCtx.totalSlashingsByIncrement
 * Every change to state.slashings should update totalSlashingsByIncrement.
 */
export function getTotalSlashingsByIncrement(state: BeaconStateAllForks): number {
  let totalSlashingsByIncrement = 0;
  const slashings = state.slashings.getAll();
  for (let i = 0; i < slashings.length; i++) {
    totalSlashingsByIncrement += Math.floor(slashings[i] / EFFECTIVE_BALANCE_INCREMENT);
  }
  return totalSlashingsByIncrement;
}
