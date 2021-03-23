/**
 * @module chain/stateTransition/epoch
 */

import {phase0, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getTotalActiveBalance, getPreviousEpoch} from "../../../../util";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH} from "../../../../constants";

/**
 * This is the reward that almost all other rewards in Ethereum are computed as a multiple of.
 * Particularly, note that it's a desired goal of the spec that effective_balance * BASE_REWARD_FACTOR
 * // integer_squareroot(total_balance) is the average per-epoch reward received by a validator under
 * theoretical best-case conditions; to achieve this, the base reward equals that amount divided by
 * BASE_REWARDS_PER_EPOCH, which is the number of times that a reward of this size will be applied.
 */
export function getBaseReward(config: IBeaconConfig, state: phase0.BeaconState, index: ValidatorIndex): Gwei {
  const totalBalance = getTotalActiveBalance(config, state);
  const effectiveBalance = state.validators[index].effectiveBalance;
  return (
    (effectiveBalance * BigInt(config.params.BASE_REWARD_FACTOR)) /
    bigIntSqrt(totalBalance) /
    BigInt(BASE_REWARDS_PER_EPOCH)
  );
}

export function getProposerReward(config: IBeaconConfig, state: phase0.BeaconState, index: ValidatorIndex): Gwei {
  return getBaseReward(config, state, index) / BigInt(config.params.PROPOSER_REWARD_QUOTIENT);
}

export function getFinalityDelay(config: IBeaconConfig, state: phase0.BeaconState): number {
  return getPreviousEpoch(config, state) - state.finalizedCheckpoint.epoch;
}

/**
 * If the chain has not been finalized for >4 epochs, the chain enters an "inactivity leak" mode,
 * where inactive validators get progressively penalized more and more, to reduce their influence
 * until blocks get finalized again. See here (https://github.com/ethereum/annotated-spec/blob/master/phase0/beacon-chain.md#inactivity-quotient) for what the inactivity leak is, what it's for and how
 * it works.
 */
export function isInInactivityLeak(config: IBeaconConfig, state: phase0.BeaconState): boolean {
  return getFinalityDelay(config, state) > config.params.MIN_EPOCHS_TO_INACTIVITY_PENALTY;
}
