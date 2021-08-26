import {altair, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR,
  PARTICIPATION_FLAG_WEIGHTS,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";
import {
  CachedBeaconState,
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED,
  FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED,
  FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED,
  hasMarkers,
  IEpochProcess,
  IEpochStakeSummary,
} from "../../allForks/util";
import {isInInactivityLeak, newZeroedArray} from "../../util";

interface IRewardPenaltyItem {
  baseReward: number;
  timelySourceReward: number;
  timelySourcePenalty: number;
  timelyTargetReward: number;
  timelyTargetPenalty: number;
  timelyHeadReward: number;
}

/**
 * An aggregate of getFlagIndexDeltas and getInactivityPenaltyDeltas that loop through process.statuses 1 time instead of 4.
 *
 * - On normal mainnet conditions
 *   - prevSourceAttester: 98%
 *   - prevTargetAttester: 96%
 *   - prevHeadAttester:   93%
 *   - currSourceAttester: 95%
 *   - currTargetAttester: 93%
 *   - currHeadAttester:   91%
 *   - unslashed:          100%
 *   - eligibleAttester:   98%
 */
export function getRewardsPenaltiesDeltas(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess
): [number[], number[]] {
  const validatorCount = state.validators.length;
  const activeIncrements = process.totalActiveStakeByIncrement;
  const rewards = newZeroedArray(validatorCount);
  const penalties = newZeroedArray(validatorCount);

  const isInInactivityLeakBn = isInInactivityLeak((state as unknown) as phase0.BeaconState);
  // effectiveBalance is multiple of EFFECTIVE_BALANCE_INCREMENT and less than MAX_EFFECTIVE_BALANCE
  // so there are limited values of them like 32000000000, 31000000000, 30000000000
  const rewardPenaltyItemCache = new Map<number, IRewardPenaltyItem>();
  const {config} = state;
  const penaltyDenominator = config.INACTIVITY_SCORE_BIAS * INACTIVITY_PENALTY_QUOTIENT_ALTAIR;
  for (let i = 0; i < process.statuses.length; i++) {
    const status = process.statuses[i];
    if (!hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      continue;
    }
    const effectiveBalance = process.validators[i].effectiveBalance;
    let rewardPenaltyItem = rewardPenaltyItemCache.get(effectiveBalance);
    if (!rewardPenaltyItem) {
      const baseReward = getBaseReward(process, i);
      const tsWeigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_SOURCE_FLAG_INDEX];
      const ttWeigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_TARGET_FLAG_INDEX];
      const thWeigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_HEAD_FLAG_INDEX];
      const tsUnslashedParticipatingIncrements = process.prevEpochUnslashedStake.sourceStakeByIncrement;
      const ttUnslashedParticipatingIncrements = process.prevEpochUnslashedStake.targetStakeByIncrement;
      const thUnslashedParticipatingIncrements = process.prevEpochUnslashedStake.headStakeByIncrement;
      const tsRewardNumerator = baseReward * tsWeigh * tsUnslashedParticipatingIncrements;
      const ttRewardNumerator = baseReward * ttWeigh * ttUnslashedParticipatingIncrements;
      const thRewardNumerator = baseReward * thWeigh * thUnslashedParticipatingIncrements;
      rewardPenaltyItem = {
        baseReward: baseReward,
        timelySourceReward: Math.floor(tsRewardNumerator / (activeIncrements * WEIGHT_DENOMINATOR)),
        timelyTargetReward: Math.floor(ttRewardNumerator / (activeIncrements * WEIGHT_DENOMINATOR)),
        timelyHeadReward: Math.floor(thRewardNumerator / (activeIncrements * WEIGHT_DENOMINATOR)),
        timelySourcePenalty: Math.floor((baseReward * tsWeigh) / WEIGHT_DENOMINATOR),
        timelyTargetPenalty: Math.floor((baseReward * ttWeigh) / WEIGHT_DENOMINATOR),
      };
      rewardPenaltyItemCache.set(effectiveBalance, rewardPenaltyItem);
    }
    const {
      timelySourceReward,
      timelySourcePenalty,
      timelyTargetReward,
      timelyTargetPenalty,
      timelyHeadReward,
    } = rewardPenaltyItem;
    // same logic to getFlagIndexDeltas
    if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED)) {
      if (!isInInactivityLeakBn) {
        rewards[i] += timelySourceReward;
      }
    } else {
      penalties[i] += timelySourcePenalty;
    }
    if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
      if (!isInInactivityLeakBn) {
        rewards[i] += timelyTargetReward;
      }
    } else {
      penalties[i] += timelyTargetPenalty;
    }
    if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED)) {
      if (!isInInactivityLeakBn) {
        rewards[i] += timelyHeadReward;
      }
    }
    // Same logic to getInactivityPenaltyDeltas
    // TODO: if we have limited value in inactivityScores we can provide a cache too
    if (!hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
      const penaltyNumerator = effectiveBalance * state.inactivityScores[i];
      penalties[i] += Math.floor(penaltyNumerator / penaltyDenominator);
    }
  }
  return [rewards, penalties];
}

/**
 * This is for spec test only as it's inefficient to loop through process.status for each flag.
 * Return the deltas for a given flag index by scanning through the participation flags.
 */
export function getFlagIndexDeltas(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess,
  flagIndex: number
): [number[], number[]] {
  const validatorCount = state.validators.length;
  const rewards = newZeroedArray(validatorCount);
  const penalties = newZeroedArray(validatorCount);

  let flag;
  let stakeSummaryKey: keyof IEpochStakeSummary;

  if (flagIndex === TIMELY_HEAD_FLAG_INDEX) {
    flag = FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED;
    stakeSummaryKey = "headStakeByIncrement";
  } else if (flagIndex === TIMELY_SOURCE_FLAG_INDEX) {
    flag = FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED;
    stakeSummaryKey = "sourceStakeByIncrement";
  } else if (flagIndex === TIMELY_TARGET_FLAG_INDEX) {
    flag = FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED;
    stakeSummaryKey = "targetStakeByIncrement";
  } else {
    throw new Error(`Unable to process flagIndex: ${flagIndex}`);
  }

  const weight = PARTICIPATION_FLAG_WEIGHTS[flagIndex];
  const unslashedParticipatingIncrements = process.prevEpochUnslashedStake[stakeSummaryKey];
  const activeIncrements = process.totalActiveStakeByIncrement;

  for (let i = 0; i < process.statuses.length; i++) {
    const status = process.statuses[i];
    if (!hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      continue;
    }
    const baseReward = getBaseReward(process, i);
    if (hasMarkers(status.flags, flag)) {
      if (!isInInactivityLeak((state as unknown) as phase0.BeaconState)) {
        const rewardNumerator = baseReward * weight * unslashedParticipatingIncrements;
        rewards[i] += Math.floor(rewardNumerator / (activeIncrements * WEIGHT_DENOMINATOR));
      }
    } else if (flagIndex !== TIMELY_HEAD_FLAG_INDEX) {
      penalties[i] += Math.floor((baseReward * weight) / WEIGHT_DENOMINATOR);
    }
  }
  return [rewards, penalties];
}

/**
 * This is for spec test only as it's inefficient to loop through process.status one more time.
 * Return the inactivity penalty deltas by considering timely target participation flags and inactivity scores.
 */
export function getInactivityPenaltyDeltas(
  state: CachedBeaconState<altair.BeaconState>,
  process: IEpochProcess
): [number[], number[]] {
  const {config} = state;
  const validatorCount = state.validators.length;
  const rewards = newZeroedArray(validatorCount);
  const penalties = newZeroedArray(validatorCount);

  for (let i = 0; i < process.statuses.length; i++) {
    const status = process.statuses[i];
    if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      if (!hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
        const penaltyNumerator = process.validators[i].effectiveBalance * state.inactivityScores[i];
        const penaltyDenominator = config.INACTIVITY_SCORE_BIAS * INACTIVITY_PENALTY_QUOTIENT_ALTAIR;
        penalties[i] += Math.floor(penaltyNumerator / penaltyDenominator);
      }
    }
  }
  return [rewards, penalties];
}

function getBaseReward(process: IEpochProcess, index: ValidatorIndex): number {
  const increments = process.validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT;
  return increments * process.baseRewardPerIncrement;
}
