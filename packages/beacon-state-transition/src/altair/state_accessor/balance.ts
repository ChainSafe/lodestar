import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, Gwei, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {getUnslashedParticipatingIndices} from "./index";
import {getPreviousEpoch} from "../../util/epoch";
import {getTotalBalance, getTotalActiveBalance} from "../../util/balance";
import {getFlagIndicesAndWeights} from "../misc";
import * as naive from "../../naive";
import {newZeroedBigIntArray} from "../../util/array";
import {isInInactivityLeak} from "../../util";
import {
  BASE_REWARD_FACTOR,
  EFFECTIVE_BALANCE_INCREMENT,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";

/**
 * Return the deltas for a given flag index by scanning through the participation flags.
 */
export function getFlagIndexDeltas(state: altair.BeaconState, flagIndex: number, weight: bigint): [Gwei[], Gwei[]] {
  const validatorCount = state.validators.length;
  const rewards = newZeroedBigIntArray(validatorCount);
  const penalties = newZeroedBigIntArray(validatorCount);

  const unslashedParticipatingIndices = getUnslashedParticipatingIndices(state, flagIndex, getPreviousEpoch(state));
  const increment = EFFECTIVE_BALANCE_INCREMENT;
  const unslashedParticipatingIncrements = getTotalBalance(state, unslashedParticipatingIndices) / increment;
  const activeIncrements = getTotalActiveBalance(state) / increment;
  // eslint-disable-next-line import/namespace
  for (const index of naive.phase0.getEligibleValidatorIndices((state as unknown) as phase0.BeaconState)) {
    const baseReward = getBaseReward(state, index);
    if (unslashedParticipatingIndices.indexOf(index) !== -1) {
      if (isInInactivityLeak(state)) {
        // This flag reward cancels the inactivity penalty corresponding to the flag index
        rewards[index] += (baseReward * weight) / WEIGHT_DENOMINATOR;
      } else {
        const rewardNumerator = baseReward * weight * unslashedParticipatingIncrements;
        rewards[index] += rewardNumerator / (activeIncrements * WEIGHT_DENOMINATOR);
      }
    } else {
      penalties[index] += (baseReward * weight) / WEIGHT_DENOMINATOR;
    }
  }
  return [rewards, penalties];
}

/**
 * Return the inactivity penalty deltas by considering timely target participation flags and inactivity scores.
 */
export function getInactivityPenaltyDeltas(config: IBeaconConfig, state: altair.BeaconState): [Gwei[], Gwei[]] {
  const validatorCount = state.validators.length;
  const rewards = newZeroedBigIntArray(validatorCount);
  const penalties = newZeroedBigIntArray(validatorCount);
  const previousEpoch = getPreviousEpoch(state);

  if (isInInactivityLeak(state)) {
    const matchingTargetAttestingIndices = getUnslashedParticipatingIndices(
      state,
      TIMELY_TARGET_FLAG_INDEX,
      previousEpoch
    );
    const inactivityScoreBias = BigInt(config.INACTIVITY_SCORE_BIAS);
    // eslint-disable-next-line import/namespace
    for (const index of naive.phase0.getEligibleValidatorIndices((state as unknown) as phase0.BeaconState)) {
      for (const [_, weight] of getFlagIndicesAndWeights()) {
        // This inactivity penalty cancels the flag reward rcorresponding to the flag index
        penalties[index] += (getBaseReward(state, index) * weight) / WEIGHT_DENOMINATOR;
      }
      if (matchingTargetAttestingIndices.indexOf(index) === -1) {
        const penaltyNumerator = state.validators[index].effectiveBalance * BigInt(state.inactivityScores[index]);
        const penaltyDenominator = inactivityScoreBias * INACTIVITY_PENALTY_QUOTIENT_ALTAIR;
        penalties[index] += penaltyNumerator / penaltyDenominator;
      }
    }
  }
  return [rewards, penalties];
}

export function getBaseRewardPerIncrement(state: altair.BeaconState): bigint {
  return (EFFECTIVE_BALANCE_INCREMENT * BigInt(BASE_REWARD_FACTOR)) / bigIntSqrt(getTotalActiveBalance(state));
}
export function getBaseReward(state: altair.BeaconState, index: ValidatorIndex): Gwei {
  const increments = state.validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT;
  return increments * getBaseRewardPerIncrement(state);
}
