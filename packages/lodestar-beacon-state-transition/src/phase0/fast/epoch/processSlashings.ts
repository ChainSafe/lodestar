import {readOnlyMap} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {bigIntMin} from "@chainsafe/lodestar-utils";

import {decreaseBalance} from "../../../util";
import {EpochContext, IEpochProcess} from "../util";

export function processSlashings(epochCtx: EpochContext, process: IEpochProcess, state: phase0.BeaconState): void {
  const totalBalance = process.totalActiveStake;
  const totalSlashings = readOnlyMap(state.slashings, (s) => s).reduce((a, b) => a + b, BigInt(0));
  const proportionalSlashingMultiplier = BigInt(epochCtx.config.params.PROPORTIONAL_SLASHING_MULTIPLIER);
  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * proportionalSlashingMultiplier, totalBalance);
  const increment = BigInt(epochCtx.config.params.EFFECTIVE_BALANCE_INCREMENT);
  for (const index of process.indicesToSlash) {
    const effectiveBalance = process.statuses[index].validator.effectiveBalance;
    const penaltyNumerator = (effectiveBalance / increment) * adjustedTotalSlashingBalance;
    const penalty = (penaltyNumerator / totalBalance) * increment;
    decreaseBalance(state, index, penalty);
  }
}
