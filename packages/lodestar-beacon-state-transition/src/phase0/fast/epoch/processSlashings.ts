import {readOnlyMap} from "@chainsafe/ssz";
import {bigIntMin} from "@chainsafe/lodestar-utils";

import {CachedValidatorsBeaconState, EpochContext, IEpochProcess} from "../util";

export function processSlashings(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: CachedValidatorsBeaconState
): void {
  const totalBalance = process.totalActiveStake;
  const totalSlashings = readOnlyMap(state.slashings, (s) => s).reduce((a, b) => a + b, BigInt(0));
  const proportionalSlashingMultiplier = BigInt(epochCtx.config.params.PROPORTIONAL_SLASHING_MULTIPLIER);
  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * proportionalSlashingMultiplier, totalBalance);
  const increment = BigInt(epochCtx.config.params.EFFECTIVE_BALANCE_INCREMENT);
  for (const index of process.indicesToSlash) {
    const effectiveBalance = process.statuses[index].validator.effectiveBalance;
    const penaltyNumerator = (effectiveBalance / increment) * adjustedTotalSlashingBalance;
    const penalty = (penaltyNumerator / totalBalance) * increment;
    state.decreaseBalanceBigInt(index, penalty);
  }
}
