/**
 * @module chain/stateTransition/util
 */

import {EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {allForks, altair, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntMax} from "@chainsafe/lodestar-utils";
import {CachedBeaconState} from "../allForks";
import {getCurrentEpoch} from "./epoch";
import {getActiveValidatorIndices, isActiveValidator} from "./validator";

/**
 * Return the combined effective balance of the [[indices]].
 * `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero.
 *
 * SLOW CODE - 🐢
 */
export function getTotalBalance(state: allForks.BeaconState, indices: ValidatorIndex[]): Gwei {
  return bigIntMax(
    EFFECTIVE_BALANCE_INCREMENT,
    indices.reduce(
      (total: Gwei, index: ValidatorIndex): Gwei => total + state.validators[index].effectiveBalance,
      BigInt(0)
    )
  );
}

/**
 * Call this function with care since it has to loop through validators which is expensive.
 * Return the combined effective balance of the active validators.
 * Note: `getTotalBalance` returns `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero.
 *
 * SLOW CODE - 🐢
 */
export function getTotalActiveBalance(state: allForks.BeaconState): Gwei {
  return getTotalBalance(state, getActiveValidatorIndices(state, getCurrentEpoch(state)));
}

/**
 * Increase the balance for a validator with the given ``index`` by ``delta``.
 */
export function increaseBalance(
  state: CachedBeaconState<allForks.BeaconState> | CachedBeaconState<altair.BeaconState>,
  index: ValidatorIndex,
  delta: number
): void {
  // TODO: Inline this
  state.balances.applyDelta(index, delta);
}

/**
 * Decrease the balance for a validator with the given ``index`` by ``delta``.
 *
 * Set to ``0`` when underflow.
 */
export function decreaseBalance(
  state: CachedBeaconState<allForks.BeaconState> | CachedBeaconState<altair.BeaconState>,
  index: ValidatorIndex,
  delta: number
): void {
  // const currentBalance = state.balances[index];
  // state.balances[index] = delta > currentBalance ? 0 : currentBalance - delta;
  state.balances.applyDelta(index, -delta);
}

/**
 * TODO - PERFORMANCE WARNING - NAIVE CODE
 * This method is used to get justified balances from a justified state.
 *
 * SLOW CODE - 🐢
 */
export function getEffectiveBalances(justifiedState: CachedBeaconState<allForks.BeaconState>): Gwei[] {
  const justifiedEpoch = justifiedState.currentShuffling.epoch;
  const effectiveBalances: Gwei[] = [];
  justifiedState.validators.forEach((v) => {
    effectiveBalances.push(isActiveValidator(v, justifiedEpoch) ? v.effectiveBalance : BigInt(0));
  });
  return effectiveBalances;
}
