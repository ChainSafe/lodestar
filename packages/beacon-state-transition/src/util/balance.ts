/**
 * @module chain/stateTransition/util
 */

import {EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {allForks, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntMax} from "@chainsafe/lodestar-utils";
import {getCurrentEpoch} from "./epoch";
import {getActiveValidatorIndices} from "./validator";

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
      // TODO: Use a fast cache to get the effective balance 🐢
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
export function increaseBalance(state: allForks.BeaconState, index: ValidatorIndex, delta: Gwei): void {
  // TODO: Inline this
  state.balances[index] = state.balances[index] + delta;
}

/**
 * Decrease the balance for a validator with the given ``index`` by ``delta``.
 *
 * Set to ``0`` when underflow.
 */
export function decreaseBalance(state: allForks.BeaconState, index: ValidatorIndex, delta: Gwei): void {
  const currentBalance = state.balances[index];
  state.balances[index] = delta > currentBalance ? BigInt(0) : currentBalance - delta;
}
