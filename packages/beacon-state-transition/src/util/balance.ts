/**
 * @module chain/stateTransition/util
 */

import {EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntMax} from "@chainsafe/lodestar-utils";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {BeaconStateAllForks} from "..";
import {CachedBeaconStateAllForks} from "../types.js";

/**
 * Return the combined effective balance of the [[indices]].
 * `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero.
 *
 * SLOW CODE - 🐢
 */
export function getTotalBalance(state: BeaconStateAllForks, indices: ValidatorIndex[]): Gwei {
  let total = BigInt(0);

  // TODO: Use a fast cache to get the effective balance 🐢
  const validatorsArr = state.validators.getAllReadonlyValues();
  for (let i = 0; i < indices.length; i++) {
    total += BigInt(validatorsArr[indices[i]].effectiveBalance);
  }

  return bigIntMax(BigInt(EFFECTIVE_BALANCE_INCREMENT), total);
}

/**
 * Increase the balance for a validator with the given ``index`` by ``delta``.
 */
export function increaseBalance(state: BeaconStateAllForks, index: ValidatorIndex, delta: number): void {
  // TODO: Inline this
  state.balances.set(index, state.balances.get(index) + delta);
}

/**
 * Decrease the balance for a validator with the given ``index`` by ``delta``.
 *
 * Set to ``0`` when underflow.
 */
export function decreaseBalance(state: BeaconStateAllForks, index: ValidatorIndex, delta: number): void {
  const newBalance = state.balances.get(index) - delta;
  // TODO: Is it necessary to protect against underflow here? Add unit test
  state.balances.set(index, Math.max(0, newBalance));
}

/**
 * This method is used to get justified balances from a justified state.
 * This is consumed by forkchoice which based on delta so we return "by increment" (in ether) value,
 * ie [30, 31, 32] instead of [30e9, 31e9, 32e9]
 */
export function getEffectiveBalanceIncrementsZeroInactive(
  justifiedState: CachedBeaconStateAllForks
): EffectiveBalanceIncrements {
  const {activeIndices} = justifiedState.epochCtx.currentShuffling;
  // 5x faster than reading from state.validators, with validator Nodes as values
  const validatorCount = justifiedState.validators.length;
  const {effectiveBalanceIncrements} = justifiedState.epochCtx;
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
