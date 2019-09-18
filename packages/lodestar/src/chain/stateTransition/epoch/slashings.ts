/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {bnMin, intDiv} from "../../../util/math";

import {decreaseBalance, getCurrentEpoch, getTotalActiveBalance,} from "../util";


/**
 * Process the slashings.
 *
 * Note that this function mutates ``state``.
 */
export function processSlashings(config: IBeaconConfig, state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const totalBalance = getTotalActiveBalance(config, state);
  const totalSlashings = state.slashings.reduce((a, b) => a.add(b), new BN(0));
  const slashingMultiplier = bnMin(totalSlashings.muln(3), totalBalance);

  state.validators.forEach((validator, index) => {
    if (
      validator.slashed &&
      (currentEpoch + intDiv(config.params.EPOCHS_PER_SLASHINGS_VECTOR, 2)) === validator.withdrawableEpoch
    ) {
      const penalty = validator.effectiveBalance
        .div(config.params.EFFECTIVE_BALANCE_INCREMENT)
        .mul(slashingMultiplier)
        .div(totalBalance)
        .mul(config.params.EFFECTIVE_BALANCE_INCREMENT);
      decreaseBalance(state, index, penalty);
    }
  });
}
