/**
 * @module chain/stateTransition/util
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntMax} from "@chainsafe/lodestar-utils";
import {phase0} from "../index";
import {CachedBeaconState} from "../fast";
import {getCurrentEpoch} from "./epoch";
import {getActiveValidatorIndices, isActiveValidator} from "./validator";

/**
 * Return the combined effective balance of the [[indices]].
 * `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero.
 */
export function getTotalBalance(config: IBeaconConfig, state: allForks.BeaconState, indices: ValidatorIndex[]): Gwei {
  return bigIntMax(
    config.params.EFFECTIVE_BALANCE_INCREMENT,
    indices.reduce(
      (total: Gwei, index: ValidatorIndex): Gwei => total + state.validators[index].effectiveBalance,
      BigInt(0)
    )
  );
}

/**
 * Return the combined effective balance of the active validators.
 * Note: `getTotalBalance` returns `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero.
 */
export function getTotalActiveBalance(config: IBeaconConfig, state: allForks.BeaconState): Gwei {
  return getTotalBalance(config, state, getActiveValidatorIndices(state, getCurrentEpoch(config, state)));
}

/**
 * Increase the balance for a validator with the given ``index`` by ``delta``.
 */
export function increaseBalance(state: allForks.BeaconState, index: ValidatorIndex, delta: Gwei): void {
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

/**
 * This method is used to get justified balances from a justified state.
 */
export function getEffectiveBalances(justifiedState: CachedBeaconState<phase0.BeaconState>): Gwei[] {
  const justifiedEpoch = justifiedState?.currentShuffling.epoch;
  const effectiveBalances: Gwei[] = [];
  justifiedState?.validators.forEach((v) => {
    effectiveBalances.push(isActiveValidator(v, justifiedEpoch!) ? v.effectiveBalance : BigInt(0));
  });
  return effectiveBalances;
}
