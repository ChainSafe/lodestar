/**
 * @module chain/stateTransition/epoch
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {decreaseBalance, getCurrentEpoch, getTotalActiveBalance} from "../../../util";
import {bigIntMin, intDiv} from "@chainsafe/lodestar-utils";

/**
 * Process the slashings.
 *
 * Note that this function mutates ``state``.
 */
export function processSlashings(config: IBeaconConfig, state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const totalBalance = getTotalActiveBalance(config, state);
  const totalSlashings = Array.from(state.slashings).reduce((a, b) => a + b, BigInt(0));
  const proportionalSlashingMultiplier = BigInt(config.params.PROPORTIONAL_SLASHING_MULTIPLIER);
  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * proportionalSlashingMultiplier, totalBalance);
  const increment = BigInt(config.params.EFFECTIVE_BALANCE_INCREMENT);

  state.validators.forEach((validator, index) => {
    if (
      validator.slashed &&
      currentEpoch + intDiv(config.params.EPOCHS_PER_SLASHINGS_VECTOR, 2) === validator.withdrawableEpoch
    ) {
      const penaltyNumerator = (validator.effectiveBalance / increment) * adjustedTotalSlashingBalance;
      const penalty = (penaltyNumerator / totalBalance) * increment;
      decreaseBalance(state, index, penalty);
    }
  });
}
