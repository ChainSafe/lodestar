/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";

import {BeaconState, Gwei, ValidatorIndex} from "../../../../types";

import {BASE_REWARD_QUOTIENT, BASE_REWARDS_PER_EPOCH} from "../../../../constants";

import {bnSqrt} from "../../../../util/math";

import {getTotalActiveBalance} from "../util";


export function getBaseReward(state: BeaconState, index: ValidatorIndex): Gwei {
  const adjustedQuotient = bnSqrt(getTotalActiveBalance(state).divn(BASE_REWARD_QUOTIENT));
  if (adjustedQuotient.eqn(0)) {
    return new BN(0);
  }
  return state.validatorRegistry[index].effectiveBalance
    .div(adjustedQuotient)
    .divn(BASE_REWARDS_PER_EPOCH);
}
