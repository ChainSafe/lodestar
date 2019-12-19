/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState, Gwei, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {getTotalActiveBalance} from "../../util";
import {bigIntSqrt} from "@chainsafe/eth2.0-utils";


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
    / BigInt(config.params.BASE_REWARDS_PER_EPOCH);
}
