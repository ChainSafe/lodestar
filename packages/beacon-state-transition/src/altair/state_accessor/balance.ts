import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {getUnslashedParticipatingIndices} from "./index";
import {getPreviousEpoch} from "../../util/epoch";
import {getTotalBalance, getTotalActiveBalance} from "../../util/balance";
import {TIMELY_HEAD_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX, WEIGHT_DENOMINATOR} from "../constants";
import {PARTICIPATION_FLAG_WEIGHTS} from "../misc";
import * as phase0 from "../../phase0";
import * as naive from "../../naive";
import {newZeroedBigIntArray} from "../../util/array";
import {isInInactivityLeak} from "../../util";

/**
 * Return the deltas for a given flag index by scanning through the participation flags.
 */
export function getFlagIndexDeltas(
  config: IBeaconConfig,
  state: altair.BeaconState,
  flagIndex: number
): [Gwei[], Gwei[]] {
  const validatorCount = state.validators.length;
  const rewards = newZeroedBigIntArray(validatorCount);
  const penalties = newZeroedBigIntArray(validatorCount);

  const unslashedParticipatingIndices = getUnslashedParticipatingIndices(
    config,
    state,
    flagIndex,
    getPreviousEpoch(config, state)
  );
  const weight = PARTICIPATION_FLAG_WEIGHTS[flagIndex];
  const increment = config.params.EFFECTIVE_BALANCE_INCREMENT;
  const unslashedParticipatingIncrements = getTotalBalance(config, state, unslashedParticipatingIndices) / increment;
  const activeIncrements = getTotalActiveBalance(config, state) / increment;
  // eslint-disable-next-line import/namespace
  for (const index of naive.phase0.getEligibleValidatorIndices(config, (state as unknown) as phase0.BeaconState)) {
    const baseReward = getBaseReward(config, state, index);
    if (unslashedParticipatingIndices.indexOf(index) !== -1) {
      if (!isInInactivityLeak(config, state)) {
        const rewardNumerator = baseReward * weight * unslashedParticipatingIncrements;
        rewards[index] += rewardNumerator / (activeIncrements * WEIGHT_DENOMINATOR);
      }
    } else if (flagIndex != TIMELY_HEAD_FLAG_INDEX) {
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
  const previousEpoch = getPreviousEpoch(config, state);

  const matchingTargetAttestingIndices = getUnslashedParticipatingIndices(
    config,
    state,
    TIMELY_TARGET_FLAG_INDEX,
    previousEpoch
  );
  // eslint-disable-next-line import/namespace
  for (const index of naive.phase0.getEligibleValidatorIndices(config, (state as unknown) as phase0.BeaconState)) {
    if (matchingTargetAttestingIndices.indexOf(index) === -1) {
      const penaltyNumerator = state.validators[index].effectiveBalance * BigInt(state.inactivityScores[index]);
      const penaltyDenominator = config.params.INACTIVITY_SCORE_BIAS * config.params.INACTIVITY_PENALTY_QUOTIENT_ALTAIR;
      penalties[index] += penaltyNumerator / penaltyDenominator;
    }
  }
  return [rewards, penalties];
}

export function getBaseRewardPerIncrement(config: IBeaconConfig, state: altair.BeaconState): bigint {
  return (
    (config.params.EFFECTIVE_BALANCE_INCREMENT * BigInt(config.params.BASE_REWARD_FACTOR)) /
    bigIntSqrt(getTotalActiveBalance(config, state))
  );
}
export function getBaseReward(config: IBeaconConfig, state: altair.BeaconState, index: ValidatorIndex): Gwei {
  const increments = state.validators[index].effectiveBalance / config.params.EFFECTIVE_BALANCE_INCREMENT;
  return increments * getBaseRewardPerIncrement(config, state);
}
