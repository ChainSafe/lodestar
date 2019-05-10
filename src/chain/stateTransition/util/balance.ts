/**
 * @module chain/stateTransition/util
 */

import BN from "bn.js";

import {
  BeaconState,
  Gwei,
  ValidatorIndex,
} from "../../../types";


/**
 * Increase the balance for a validator with the given ``index`` by ``delta``.
 */
export function increaseBalance(state: BeaconState, index: ValidatorIndex, delta: Gwei): void {
  state.balances[index] = state.balances[index].add(delta);
}

/**
 * Decrease the balance for a validator with the given ``index`` by ``delta``.
 *
 * Set to ``0`` when underflow.
 */
export function decreaseBalance(state: BeaconState, index: ValidatorIndex, delta: Gwei): void {
  const currentBalance = state.balances[index];
  state.balances[index] = delta.gt(currentBalance)
    ? new BN(0)
    : currentBalance.sub(delta);
}

/**
 * Return the combined effective balance of an array of validators.
 */
export function getTotalBalance(state: BeaconState, indices: ValidatorIndex[]): Gwei {
  return indices.reduce((total: Gwei, index: ValidatorIndex): Gwei =>
    total.add(state.validatorRegistry[index].effectiveBalance), new BN(0));
}
