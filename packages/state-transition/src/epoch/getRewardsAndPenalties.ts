import {
  EFFECTIVE_BALANCE_INCREMENT,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR,
  INACTIVITY_PENALTY_QUOTIENT_BELLATRIX,
  PARTICIPATION_FLAG_WEIGHTS,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
  ForkSeq,
} from "@lodestar/params";
import {CachedBeaconStateAltair, EpochTransitionCache} from "../types.js";
import {
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER_UNSLASHED,
  FLAG_PREV_SOURCE_ATTESTER_UNSLASHED,
  FLAG_PREV_TARGET_ATTESTER_UNSLASHED,
  hasMarkers,
} from "../util/attesterStatus.js";
import {isInInactivityLeak} from "../util/index.js";

type RewardPenaltyItem = {
  baseReward: number;
  timelySourceReward: number;
  timelySourcePenalty: number;
  timelyTargetReward: number;
  timelyTargetPenalty: number;
  timelyHeadReward: number;
};

/**
 * This data is reused and never gc.
 */
const rewards = new Array<number>();
const penalties = new Array<number>();
/**
 * An aggregate of getFlagIndexDeltas and getInactivityPenaltyDeltas that loop through process.flags 1 time instead of 4.
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
export function getRewardsAndPenaltiesAltair(
  state: CachedBeaconStateAltair,
  cache: EpochTransitionCache
): [number[], number[]] {
  // TODO: Is there a cheaper way to measure length that going to `state.validators`?
  const validatorCount = state.validators.length;
  const activeIncrements = cache.totalActiveStakeByIncrement;
  rewards.length = validatorCount;
  rewards.fill(0);
  penalties.length = validatorCount;
  penalties.fill(0);

  const isInInactivityLeakBn = isInInactivityLeak(state);
  // effectiveBalance is multiple of EFFECTIVE_BALANCE_INCREMENT and less than MAX_EFFECTIVE_BALANCE
  // so there are limited values of them like 32, 31, 30
  const rewardPenaltyItemCache = new Map<number, RewardPenaltyItem>();
  const {config, epochCtx} = state;
  const fork = config.getForkSeq(state.slot);

  const inactivityPenalityMultiplier =
    fork === ForkSeq.altair ? INACTIVITY_PENALTY_QUOTIENT_ALTAIR : INACTIVITY_PENALTY_QUOTIENT_BELLATRIX;
  const penaltyDenominator = config.INACTIVITY_SCORE_BIAS * inactivityPenalityMultiplier;

  const {flags} = cache;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (!hasMarkers(flag, FLAG_ELIGIBLE_ATTESTER)) {
      continue;
    }

    const effectiveBalanceIncrement = epochCtx.effectiveBalanceIncrements[i];

    let rewardPenaltyItem = rewardPenaltyItemCache.get(effectiveBalanceIncrement);
    if (!rewardPenaltyItem) {
      const baseReward = effectiveBalanceIncrement * cache.baseRewardPerIncrement;
      const tsWeigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_SOURCE_FLAG_INDEX];
      const ttWeigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_TARGET_FLAG_INDEX];
      const thWeigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_HEAD_FLAG_INDEX];
      const tsUnslashedParticipatingIncrements = cache.prevEpochUnslashedStake.sourceStakeByIncrement;
      const ttUnslashedParticipatingIncrements = cache.prevEpochUnslashedStake.targetStakeByIncrement;
      const thUnslashedParticipatingIncrements = cache.prevEpochUnslashedStake.headStakeByIncrement;
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
      rewardPenaltyItemCache.set(effectiveBalanceIncrement, rewardPenaltyItem);
    }

    const {timelySourceReward, timelySourcePenalty, timelyTargetReward, timelyTargetPenalty, timelyHeadReward} =
      rewardPenaltyItem;

    // same logic to getFlagIndexDeltas
    if (hasMarkers(flag, FLAG_PREV_SOURCE_ATTESTER_UNSLASHED)) {
      if (!isInInactivityLeakBn) {
        rewards[i] += timelySourceReward;
      }
    } else {
      penalties[i] += timelySourcePenalty;
    }

    if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
      if (!isInInactivityLeakBn) {
        rewards[i] += timelyTargetReward;
      }
    } else {
      penalties[i] += timelyTargetPenalty;
    }

    if (hasMarkers(flag, FLAG_PREV_HEAD_ATTESTER_UNSLASHED)) {
      if (!isInInactivityLeakBn) {
        rewards[i] += timelyHeadReward;
      }
    }

    // Same logic to getInactivityPenaltyDeltas
    // TODO: if we have limited value in inactivityScores we can provide a cache too
    if (!hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
      const penaltyNumerator = effectiveBalanceIncrement * EFFECTIVE_BALANCE_INCREMENT * state.inactivityScores.get(i);
      penalties[i] += Math.floor(penaltyNumerator / penaltyDenominator);
    }
  }

  return [rewards, penalties];
}
