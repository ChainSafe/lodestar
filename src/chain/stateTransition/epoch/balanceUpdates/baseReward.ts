/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState, Gwei, ValidatorIndex} from "../../../../types";

import {BASE_REWARD_FACTOR, BASE_REWARDS_PER_EPOCH} from "../../../../constants";

import {bnSqrt} from "../../../../util/math";

import {getTotalActiveBalance} from "../util";


export function getBaseReward(state: BeaconState, index: ValidatorIndex): Gwei {
  const totalBalance = getTotalActiveBalance(state);
  const effectiveBalance = state.validatorRegistry[index].effectiveBalance;
  return effectiveBalance.muln(BASE_REWARD_FACTOR)
    .div(bnSqrt(totalBalance)).divn(BASE_REWARDS_PER_EPOCH);
}
