import {allForks} from "@chainsafe/lodestar-types";
import {bigIntMin} from "@chainsafe/lodestar-utils";
import {readonlyValues} from "@chainsafe/ssz";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkName,
  PROPORTIONAL_SLASHING_MULTIPLIER,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR,
} from "@chainsafe/lodestar-params";

import {decreaseBalance} from "../../util";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";

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
  state: CachedBeaconState<allForks.BeaconState>,
  process: IEpochProcess
): void {
  // No need to compute totalSlashings if there no index to slash
  if (process.indicesToSlash.length === 0) {
    return;
  }

  const totalBalance = process.totalActiveStake;
  const totalSlashings = Array.from(readonlyValues(state.slashings)).reduce((a, b) => a + b, BigInt(0));

  const proportionalSlashingMultiplier =
    fork === ForkName.phase0 ? PROPORTIONAL_SLASHING_MULTIPLIER : PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR;

  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * proportionalSlashingMultiplier, totalBalance);
  const increment = EFFECTIVE_BALANCE_INCREMENT;
  for (const index of process.indicesToSlash) {
    const effectiveBalance = process.validators[index].effectiveBalance;
    const penaltyNumerator = (effectiveBalance / increment) * adjustedTotalSlashingBalance;
    const penalty = (penaltyNumerator / totalBalance) * increment;
    decreaseBalance(state, index, Number(penalty));
  }
}
