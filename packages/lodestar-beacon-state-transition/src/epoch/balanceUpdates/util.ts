/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getTotalActiveBalance, getPreviousEpoch} from "../../util";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH} from "../../constants";


export function getBaseReward(
  config: IBeaconConfig,
  state: BeaconState,
  index: ValidatorIndex
): Gwei {
  const totalBalance = getTotalActiveBalance(config, state);
  const effectiveBalance = state.validators[index].effectiveBalance;
  return effectiveBalance
    * BigInt(config.params.BASE_REWARD_FACTOR)
    / bigIntSqrt(totalBalance)
    / BigInt(BASE_REWARDS_PER_EPOCH);
}

export function getProposerReward(
  config: IBeaconConfig,
  state: BeaconState,
  index: ValidatorIndex
): Gwei {
  return getBaseReward(config, state, index) / BigInt(config.params.PROPOSER_REWARD_QUOTIENT);
}

export function getFinalityDelay(
  config: IBeaconConfig,
  state: BeaconState
): number {
  return getPreviousEpoch(config, state) - state.finalizedCheckpoint.epoch;
}

export function isInInactivityLeak(
  config: IBeaconConfig,
  state: BeaconState
): boolean {
  return getFinalityDelay(config, state) > config.params.MIN_EPOCHS_TO_INACTIVITY_PENALTY;
}