/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState, Gwei, ValidatorIndex} from "../../../../types";
import {IBeaconConfig} from "../../../../config";

import {bnSqrt} from "../../../../util/math";

import {getTotalActiveBalance} from "../../util";


export function getBaseReward(
  config: IBeaconConfig,
  state: BeaconState,
  index: ValidatorIndex
): Gwei {
  const totalBalance = getTotalActiveBalance(config, state);
  const effectiveBalance = state.validators[index].effectiveBalance;
  return effectiveBalance.muln(config.params.BASE_REWARD_FACTOR)
    .div(bnSqrt(totalBalance)).divn(config.params.BASE_REWARDS_PER_EPOCH);
}
