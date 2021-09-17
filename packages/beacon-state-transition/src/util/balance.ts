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
  state.balanceList.applyDelta(index, delta);
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
  state.balanceList.applyDelta(index, -delta);
}

/**
 * This method is used to get justified balances from a justified state.
 * This is consumed by forkchoice which based on delta so we return "by increment" (in ether) value,
 * ie [30, 31, 32] instead of [30e9, 31e9, 32e9]
 */
export function getEffectiveBalances(justifiedState: CachedBeaconState<allForks.BeaconState>): number[] {
  const {activeIndices} = justifiedState.currentShuffling;
  // 5x faster than using readonlyValuesListOfLeafNodeStruct
  const count = justifiedState.validators.length;
  const {effectiveBalances} = justifiedState;
  const effectiveBalancesArr = new Array<number>(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    if (i === activeIndices[j]) {
      // active validator
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      effectiveBalancesArr[i] = Math.floor(effectiveBalances.get(i)! / EFFECTIVE_BALANCE_INCREMENT);
      j++;
    } else {
      // inactive validator
      effectiveBalancesArr[i] = 0;
    }
  }
  return effectiveBalancesArr;
}
