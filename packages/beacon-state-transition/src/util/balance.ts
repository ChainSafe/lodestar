/**
 * @module chain/stateTransition/util
 */

import {EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {allForks, altair, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntMax} from "@chainsafe/lodestar-utils";
import {CachedBeaconState} from "../allForks";

/**
 * Return the combined effective balance of the [[indices]].
 * `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero.
 *
 * SLOW CODE - 🐢
 */
export function getTotalBalance(state: allForks.BeaconState, indices: ValidatorIndex[]): Gwei {
  return bigIntMax(
    BigInt(EFFECTIVE_BALANCE_INCREMENT),
    indices.reduce(
      // TODO: Use a fast cache to get the effective balance 🐢
      (total: Gwei, index: ValidatorIndex): Gwei => total + BigInt(state.validators[index].effectiveBalance),
      BigInt(0)
    )
  );
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
  state.balances.applyDelta(index, -delta);
}

/**
 * This method is used to get justified balances from a justified state.
 */
export function getEffectiveBalances(justifiedState: CachedBeaconState<allForks.BeaconState>): number[] {
  const {activeIndices} = justifiedState.currentShuffling;
  // 5x faster than using readonlyValuesListOfLeafNodeStruct
  const effectiveBalances = justifiedState.effectiveBalances.toArray();
  let j = 0;
  for (let i = 0; i < effectiveBalances.length; i++) {
    // same logic to checking activeIndices.includes(i) since activeIndices is sorted
    if (i !== activeIndices[j]) {
      // inactive validator
      effectiveBalances[i] = 0;
    } else {
      // active validator, keep effective balance as is
      j++;
    }
  }
  return effectiveBalances;
}
