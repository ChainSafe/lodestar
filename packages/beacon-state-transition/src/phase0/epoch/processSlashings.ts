import {allForks, phase0} from "@chainsafe/lodestar-types";
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

export function processSlashings(state: CachedBeaconState<phase0.BeaconState>, process: IEpochProcess): void {
  processSlashingsAllForks(ForkName.phase0, state as CachedBeaconState<allForks.BeaconState>, process);
}

export function processSlashingsAllForks(
  fork: ForkName,
  state: CachedBeaconState<allForks.BeaconState>,
  process: IEpochProcess
): void {
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
    decreaseBalance(state, index, penalty);
  }
}
