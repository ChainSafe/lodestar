/**
 * @module chain/stateTransition/epoch
 */

import {phase0, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {getTotalActiveBalance} from "../../../../util";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH} from "../../../../constants";
import {BASE_REWARD_FACTOR, PROPOSER_REWARD_QUOTIENT} from "@chainsafe/lodestar-params";

/**
 * This is the reward that almost all other rewards in Ethereum are computed as a multiple of.
 * Particularly, note that it's a desired goal of the spec that effective_balance * BASE_REWARD_FACTOR
 * // integer_squareroot(total_balance) is the average per-epoch reward received by a validator under
 * theoretical best-case conditions; to achieve this, the base reward equals that amount divided by
 * BASE_REWARDS_PER_EPOCH, which is the number of times that a reward of this size will be applied.
 */
export function getBaseReward(state: phase0.BeaconState, index: ValidatorIndex): Gwei {
  const totalBalance = getTotalActiveBalance(state);
  const effectiveBalance = state.validators[index].effectiveBalance;
  return (effectiveBalance * BigInt(BASE_REWARD_FACTOR)) / bigIntSqrt(totalBalance) / BigInt(BASE_REWARDS_PER_EPOCH);
}

export function getProposerReward(state: phase0.BeaconState, index: ValidatorIndex): Gwei {
  return getBaseReward(state, index) / BigInt(PROPOSER_REWARD_QUOTIENT);
}
