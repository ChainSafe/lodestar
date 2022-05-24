import {bigIntMin} from "@chainsafe/lodestar-utils";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkName,
  PROPORTIONAL_SLASHING_MULTIPLIER,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR,
  PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX,
} from "@chainsafe/lodestar-params";

import {decreaseBalance} from "../../util/index.js";
import {CachedBeaconStateAllForks, EpochProcess} from "../../types.js";

/**
 * Update validator registry for validators that activate + exit
 *
 * PERF: Cost 'proportional' to only validators that are slashed. For mainnet conditions:
 * - indicesToSlash: max len is 8704. But it's very unlikely since it would require all validators on the same
 *   committees to sign slashable attestations.
 *
 * - On normal mainnet conditions indicesToSlash = 0
 */
export function processSlashingsAllForks(
  fork: ForkName,
  state: CachedBeaconStateAllForks,
  process: EpochProcess
): void {
  // No need to compute totalSlashings if there no index to slash
  if (process.indicesToSlash.length === 0) {
    return;
  }
  // TODO: have the regular totalBalance in EpochProcess too?
  const totalBalance = BigInt(process.totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT);

  // TODO: Could totalSlashings be number?
  // TODO: Could totalSlashing be cached?
  let totalSlashings = BigInt(0);
  const slashings = state.slashings.getAll();
  for (let i = 0; i < slashings.length; i++) {
    totalSlashings += slashings[i];
  }

  const proportionalSlashingMultiplier =
    fork === ForkName.phase0
      ? PROPORTIONAL_SLASHING_MULTIPLIER
      : fork === ForkName.altair
      ? PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR
      : PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX;

  const {effectiveBalanceIncrements} = state.epochCtx;
  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * BigInt(proportionalSlashingMultiplier), totalBalance);
  const increment = EFFECTIVE_BALANCE_INCREMENT;
  for (const index of process.indicesToSlash) {
    const effectiveBalanceIncrement = effectiveBalanceIncrements[index];
    const penaltyNumerator = BigInt(effectiveBalanceIncrement) * adjustedTotalSlashingBalance;
    const penalty = Number(penaltyNumerator / totalBalance) * increment;
    decreaseBalance(state, index, penalty);
  }
}
