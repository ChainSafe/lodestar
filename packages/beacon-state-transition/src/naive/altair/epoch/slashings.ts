/**
 * @module chain/stateTransition/epoch
 */

import {altair} from "@chainsafe/lodestar-types";
import {decreaseBalance, getCurrentEpoch, getTotalActiveBalance} from "../../../util";
import {bigIntMin, intDiv} from "@chainsafe/lodestar-utils";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_SLASHINGS_VECTOR,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR,
} from "@chainsafe/lodestar-params";

/**
 * Process the slashings.
 *
 * Note that this function mutates ``state``.
 */
export function processSlashings(state: altair.BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const totalBalance = getTotalActiveBalance(state);
  const totalSlashings = Array.from(state.slashings).reduce((a, b) => a + b, BigInt(0));
  const proportionalSlashingMultiplier = BigInt(PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR);
  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * proportionalSlashingMultiplier, totalBalance);
  const increment = BigInt(EFFECTIVE_BALANCE_INCREMENT);

  let index = 0;
  for (const validator of state.validators) {
    if (validator.slashed && currentEpoch + intDiv(EPOCHS_PER_SLASHINGS_VECTOR, 2) === validator.withdrawableEpoch) {
      const penaltyNumerator = (validator.effectiveBalance / increment) * adjustedTotalSlashingBalance;
      const penalty = (penaltyNumerator / totalBalance) * increment;
      decreaseBalance(state, index, penalty);
    }
    index++;
  }
}

export function processSlashingsReset(state: altair.BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const nextEpoch = currentEpoch + 1;
  // Reset slashings
  state.slashings[nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR] = BigInt(0);
}
