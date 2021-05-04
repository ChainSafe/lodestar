import {altair, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {getFlagIndicesAndWeights} from "../../misc";
import * as phase0 from "../../../phase0";
import {
  CachedBeaconState,
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED,
  FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED,
  FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED,
  hasMarkers,
  IEpochProcess,
  IEpochStakeSummary,
} from "../../../fast/util";
import {newZeroedBigIntArray} from "../../../util";
import {
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
} from "../../constants";

/**
 * Return the deltas for a given flag index by scanning through the participation flags.
 */
export function getFlagIndexDeltas(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess,
  flagIndex: number,
  weight: bigint
): [Gwei[], Gwei[]] {
  const {config} = state;
  const validatorCount = state.validators.length;
  const rewards = newZeroedBigIntArray(validatorCount);
  const penalties = newZeroedBigIntArray(validatorCount);

  const increment = config.params.EFFECTIVE_BALANCE_INCREMENT;

  let flag;
  let stakeSummaryKey: keyof IEpochStakeSummary;

  if (flagIndex === TIMELY_HEAD_FLAG_INDEX) {
    flag = FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED;
    stakeSummaryKey = "headStake";
  } else if (flagIndex === TIMELY_SOURCE_FLAG_INDEX) {
    flag = FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED;
    stakeSummaryKey = "sourceStake";
  } else if (flagIndex === TIMELY_TARGET_FLAG_INDEX) {
    flag = FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED;
    stakeSummaryKey = "targetStake";
  } else {
    throw new Error(`Unable to process flagIndex: ${flagIndex}`);
  }

  const unslashedParticipatingIncrements = process.prevEpochUnslashedStake[stakeSummaryKey] / increment;
  const activeIncrements = process.totalActiveStake / increment;

  for (let i = 0; i < process.statuses.length; i++) {
    const status = process.statuses[i];
    if (!hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      continue;
    }
    const baseReward = getBaseReward(state, process, i);
    if (hasMarkers(status.flags, flag)) {
      if (phase0.isInInactivityLeak(config, (state as unknown) as phase0.BeaconState)) {
        // This flag reward cancels the inactivity penalty corresponding to the flag index
        rewards[i] += (baseReward * weight) / WEIGHT_DENOMINATOR;
      } else {
        const rewardNumerator = baseReward * weight * unslashedParticipatingIncrements;
        rewards[i] += rewardNumerator / (activeIncrements * WEIGHT_DENOMINATOR);
      }
    } else {
      penalties[i] += (baseReward * weight) / WEIGHT_DENOMINATOR;
    }
  }
  return [rewards, penalties];
}

/**
 * Return the inactivity penalty deltas by considering timely target participation flags and inactivity scores.
 */
export function getInactivityPenaltyDeltas(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess
): [Gwei[], Gwei[]] {
  const {config} = state;
  const validatorCount = state.validators.length;
  const rewards = newZeroedBigIntArray(validatorCount);
  const penalties = newZeroedBigIntArray(validatorCount);

  if (phase0.isInInactivityLeak(config, (state as unknown) as phase0.BeaconState)) {
    for (let i = 0; i < process.statuses.length; i++) {
      const status = process.statuses[i];
      if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
        for (const [_, weight] of getFlagIndicesAndWeights()) {
          // This inactivity penalty cancels the flag reward rcorresponding to the flag index
          penalties[i] += (getBaseReward(state, process, i) * weight) / WEIGHT_DENOMINATOR;
        }
        if (!hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
          const penaltyNumerator = process.validators[i].effectiveBalance * BigInt(state.inactivityScores[i]);
          const penaltyDenominator =
            config.params.INACTIVITY_SCORE_BIAS * config.params.INACTIVITY_PENALTY_QUOTIENT_ALTAIR;
          penalties[i] += penaltyNumerator / penaltyDenominator;
        }
      }
    }
  }
  return [rewards, penalties];
}

export function getBaseRewardPerIncrement(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess
): bigint {
  const {config} = state;
  return (
    (config.params.EFFECTIVE_BALANCE_INCREMENT * BigInt(config.params.BASE_REWARD_FACTOR)) /
    bigIntSqrt(process.totalActiveStake)
  );
}
export function getBaseReward(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess,
  index: ValidatorIndex
): bigint {
  const {config} = state;
  const increments = state.validators[index].effectiveBalance / config.params.EFFECTIVE_BALANCE_INCREMENT;
  return increments * getBaseRewardPerIncrement(state, process);
}
