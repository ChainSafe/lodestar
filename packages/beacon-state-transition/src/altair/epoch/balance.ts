import {allForks, altair} from "@chainsafe/lodestar-types";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR,
  INACTIVITY_PENALTY_QUOTIENT_MERGE,
  PARTICIPATION_FLAG_WEIGHTS,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
  ForkName,
} from "@chainsafe/lodestar-params";
import {
  CachedBeaconState,
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED,
  FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED,
  FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED,
  hasMarkers,
  IEpochProcess,
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
  // TODO: Is there a cheaper way to measure length that going to `state.validators`?
  const validatorCount = state.validators.length;
  const activeIncrements = process.totalActiveStakeByIncrement;
  const rewards = newZeroedArray(validatorCount);
  const penalties = newZeroedArray(validatorCount);

  const isInInactivityLeakBn = isInInactivityLeak(state as CachedBeaconState<allForks.BeaconState>);
  // effectiveBalance is multiple of EFFECTIVE_BALANCE_INCREMENT and less than MAX_EFFECTIVE_BALANCE
  // so there are limited values of them like 32000000000, 31000000000, 30000000000
  const rewardPenaltyItemCache = new Map<number, IRewardPenaltyItem>();
  const {config, epochCtx} = state;
  const fork = config.getForkName(state.slot);

  const inactivityPenalityMultiplier =
    fork === ForkName.altair ? INACTIVITY_PENALTY_QUOTIENT_ALTAIR : INACTIVITY_PENALTY_QUOTIENT_MERGE;
  const penaltyDenominator = config.INACTIVITY_SCORE_BIAS * inactivityPenalityMultiplier;

  const {statuses} = process;
  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    if (!hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const effectiveBalance = epochCtx.effectiveBalances.get(i)!;
    let rewardPenaltyItem = rewardPenaltyItemCache.get(effectiveBalance);
    if (!rewardPenaltyItem) {
      const baseReward = (effectiveBalance / EFFECTIVE_BALANCE_INCREMENT) * process.baseRewardPerIncrement;
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
