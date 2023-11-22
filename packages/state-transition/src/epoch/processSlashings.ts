import {bigIntMin} from "@lodestar/utils";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  PROPORTIONAL_SLASHING_MULTIPLIER,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR,
  PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX,
} from "@lodestar/params";

import {decreaseBalance} from "../util/index.js";
import {CachedBeaconStateAllForks, EpochTransitionCache} from "../types.js";

/**
 * Update validator registry for validators that activate + exit
 * updateBalance is an optimization:
 * - For spec test, it's true
 * - For processEpoch flow, it's false, i.e to only update balances once in processRewardsAndPenalties()
 *
 * PERF: Cost 'proportional' to only validators that are slashed. For mainnet conditions:
 * - indicesToSlash: max len is 8704. But it's very unlikely since it would require all validators on the same
 *   committees to sign slashable attestations.
 *
 * - On normal mainnet conditions indicesToSlash = 0
 */
export function processSlashings(
  state: CachedBeaconStateAllForks,
  cache: EpochTransitionCache,
  updateBalance = true
): number[] {
  // No need to compute totalSlashings if there no index to slash
  if (cache.indicesToSlash.length === 0) {
    return [];
  }
  // TODO: have the regular totalBalance in EpochTransitionCache too?
  const totalBalance = BigInt(cache.totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT);

  // TODO: Could totalSlashings be number?
  // TODO: Could totalSlashing be cached?
  let totalSlashings = BigInt(0);
  const slashings = state.slashings.getAll();
  for (let i = 0; i < slashings.length; i++) {
    totalSlashings += slashings[i];
  }

  const fork = state.config.getForkSeq(state.slot);
  const proportionalSlashingMultiplier =
    fork === ForkSeq.phase0
      ? PROPORTIONAL_SLASHING_MULTIPLIER
      : fork === ForkSeq.altair
      ? PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR
      : PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX;

  const {effectiveBalanceIncrements} = state.epochCtx;
  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * BigInt(proportionalSlashingMultiplier), totalBalance);
  const increment = EFFECTIVE_BALANCE_INCREMENT;
  const penalties: number[] = [];
  const penaltiesByEffectiveBalanceIncrement = new Map<number, number>();
  for (const index of cache.indicesToSlash) {
    const effectiveBalanceIncrement = effectiveBalanceIncrements[index];
    let penalty = penaltiesByEffectiveBalanceIncrement.get(effectiveBalanceIncrement);
    if (penalty === undefined) {
      const penaltyNumerator = BigInt(effectiveBalanceIncrement) * adjustedTotalSlashingBalance;
      penalty = Number(penaltyNumerator / totalBalance) * increment;
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
