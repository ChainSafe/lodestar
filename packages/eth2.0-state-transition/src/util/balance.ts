/**
 * @module chain/stateTransition/util
 */

import {
  BeaconState,
  Gwei,
  ValidatorIndex,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {getCurrentEpoch} from "./epoch";
import {getActiveValidatorIndices} from "./validator";
import {bnMax} from "@chainsafe/eth2.0-utils";


/**
 * Return the combined effective balance of the [[indices]]. (1 Gwei minimum to avoid divisions by zero.)
 */
export function getTotalBalance(state: BeaconState, indices: ValidatorIndex[]): Gwei {
  return bnMax(
    1n,
    indices.reduce((total: Gwei, index: ValidatorIndex): Gwei =>
      total + state.validators[index].effectiveBalance, 0n)
  );
}

/**
 * Return the combined effective balance of the active validators.
 */
export function getTotalActiveBalance(config: IBeaconConfig, state: BeaconState): Gwei {
  return getTotalBalance(state, getActiveValidatorIndices(state, getCurrentEpoch(config, state)));
}

/**
 * Increase the balance for a validator with the given ``index`` by ``delta``.
 */
export function increaseBalance(state: BeaconState, index: ValidatorIndex, delta: Gwei): void {
  state.balances[index] = state.balances[index] + delta;
}

/**
 * Decrease the balance for a validator with the given ``index`` by ``delta``.
 *
 * Set to ``0`` when underflow.
 */
export function decreaseBalance(state: BeaconState, index: ValidatorIndex, delta: Gwei): void {
  const currentBalance = state.balances[index];
  state.balances[index] = delta > currentBalance
    ? 0n
    : currentBalance - delta;
}
