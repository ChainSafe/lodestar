import {CachedBeaconState, allForks, isActiveValidator} from "@chainsafe/lodestar-beacon-state-transition";
import {Gwei} from "@chainsafe/lodestar-types";

/**
 * TODO - PERFORMANCE WARNING - NAIVE CODE
 * This method is used to get justified balances from a justified state.
 *
 * SLOW CODE - 🐢🐢🐢🐢🐢🐢🐢🐢🐢🐢🐢
 */
export function getEffectiveBalances(justifiedState: CachedBeaconState<allForks.BeaconState>): Gwei[] {
  const justifiedEpoch = justifiedState.currentShuffling.epoch;
  const effectiveBalances: Gwei[] = [];

  for (let i = 0, len = justifiedState.validators.length; i < len; i++) {
    const v = justifiedState.validators[i];
    effectiveBalances.push(isActiveValidator(v, justifiedEpoch) ? v.effectiveBalance : BigInt(0));
  }
  return effectiveBalances;
}
