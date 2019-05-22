/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "../../../types";

import {
  LATEST_SLASHED_EXIT_LENGTH, MIN_SLASHING_PENALTY_QUOTIENT,
} from "../../../constants";

import {bnMax, bnMin, intDiv} from "../../../util/math";

import {
  getActiveValidatorIndices, getCurrentEpoch,
  getTotalBalance, decreaseBalance,
} from "../util";


/**
 * Process the slashings.
 *
 * Note that this function mutates ``state``.
 */
export function processSlashings(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const activeValidatorIndices = getActiveValidatorIndices(state, currentEpoch);
  const totalBalance = getTotalBalance(state, activeValidatorIndices);

  // Compute `totalPenalties`
  const totalAtStart = state.latestSlashedBalances[(currentEpoch + 1) % LATEST_SLASHED_EXIT_LENGTH];
  const totalAtEnd = state.latestSlashedBalances[currentEpoch % LATEST_SLASHED_EXIT_LENGTH];
  const totalPenalties = totalAtEnd.sub(totalAtStart);

  state.validatorRegistry.forEach((validator, index) => {
    if (validator.slashed && currentEpoch ===
      intDiv(validator.withdrawableEpoch - LATEST_SLASHED_EXIT_LENGTH, 2)) {
      const penalty = bnMax(
        validator.effectiveBalance.mul(bnMin(totalPenalties.muln(3), totalBalance))
          .div(totalBalance),
        validator.effectiveBalance.divn(MIN_SLASHING_PENALTY_QUOTIENT)
      );
      decreaseBalance(state, index, penalty);
    }
  });
}
