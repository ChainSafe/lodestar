/**
 * @module chain/stateTransition/util
 */

import {EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {allForks, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntMax} from "@chainsafe/lodestar-utils";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../types";

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
  state: CachedBeaconStateAllForks | CachedBeaconStateAltair,
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
  state: CachedBeaconStateAllForks | CachedBeaconStateAltair,
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
export function getEffectiveBalanceIncrementsZeroInactive(
  justifiedState: CachedBeaconStateAllForks
): EffectiveBalanceIncrements {
  const {activeIndices} = justifiedState.currentShuffling;
  // 5x faster than using readonlyValuesListOfLeafNodeStruct
  const validatorCount = justifiedState.validators.length;
  const {effectiveBalanceIncrements} = justifiedState;
  // Slice up to `validatorCount` since it won't be mutated, nor accessed beyond `validatorCount`
  const effectiveBalanceIncrementsZeroInactive = effectiveBalanceIncrements.slice(0, validatorCount);

  let j = 0;
  for (let i = 0; i < validatorCount; i++) {
    if (i === activeIndices[j]) {
      // active validator
      j++;
    } else {
      // inactive validator
      effectiveBalanceIncrementsZeroInactive[i] = 0;
    }
  }

  return effectiveBalanceIncrementsZeroInactive;
}
