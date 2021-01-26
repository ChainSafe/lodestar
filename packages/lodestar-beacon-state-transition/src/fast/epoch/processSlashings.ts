import {readOnlyMap} from "@chainsafe/ssz";
import {bigIntMin} from "@chainsafe/lodestar-utils";

import {decreaseBalance} from "../../util";
import {CachedBeaconState} from "../util/cachedBeaconState";
import {IEpochProcess} from "../util/epochProcess";

export function processSlashings(cachedState: CachedBeaconState, process: IEpochProcess): void {
  const totalBalance = process.totalActiveStake;
  const totalSlashings = readOnlyMap(cachedState.slashings, (s) => s).reduce((a, b) => a + b, BigInt(0));
  const proportionalSlashingMultiplier = BigInt(cachedState.config.params.PROPORTIONAL_SLASHING_MULTIPLIER);
  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * proportionalSlashingMultiplier, totalBalance);
  const increment = BigInt(cachedState.config.params.EFFECTIVE_BALANCE_INCREMENT);
  for (const index of process.indicesToSlash) {
    const effectiveBalance = process.statuses[index].validator.effectiveBalance;
    const penaltyNumerator = (effectiveBalance / increment) * adjustedTotalSlashingBalance;
    const penalty = (penaltyNumerator / totalBalance) * increment;
    decreaseBalance(cachedState, index, penalty);
  }
}
