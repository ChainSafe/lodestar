/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {decreaseBalance, getCurrentEpoch, getTotalActiveBalance,} from "../util";
import {bnMin, intDiv} from "@chainsafe/eth2.0-utils";


/**
 * Process the slashings.
 *
 * Note that this function mutates ``state``.
 */
export function processSlashings(config: IBeaconConfig, state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const totalBalance = getTotalActiveBalance(config, state);
  const totalSlashings = state.slashings.reduce((a, b) => a + b, 0n);
  const slashingMultiplier = bnMin(totalSlashings * 3n, totalBalance);

  state.validators.forEach((validator, index) => {
    if (
      validator.slashed &&
      (currentEpoch + intDiv(config.params.EPOCHS_PER_SLASHINGS_VECTOR, 2)) === validator.withdrawableEpoch
    ) {
      const penalty = validator.effectiveBalance / config.params.EFFECTIVE_BALANCE_INCREMENT *
        slashingMultiplier / totalBalance * config.params.EFFECTIVE_BALANCE_INCREMENT

      decreaseBalance(state, index, penalty);
    }
  });
}
