import {bigIntSqrt, bnToNum} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH as BASE_REWARDS_PER_EPOCH_CONST} from "../../constants/index.js";
import {newZeroedArray} from "../../util/index.js";
import {EpochProcess, CachedBeaconStatePhase0} from "../../types.js";
import {
  BASE_REWARD_FACTOR,
  EFFECTIVE_BALANCE_INCREMENT,
  INACTIVITY_PENALTY_QUOTIENT,
  MIN_EPOCHS_TO_INACTIVITY_PENALTY,
  PROPOSER_REWARD_QUOTIENT,
} from "@chainsafe/lodestar-params";
import {hasMarkers} from "../../util/attesterStatus.js";

/**
 * Redefine constants in attesterStatus to improve performance
 */
const FLAG_PREV_SOURCE_ATTESTER = 1 << 0;
const FLAG_PREV_TARGET_ATTESTER = 1 << 1;
const FLAG_PREV_HEAD_ATTESTER = 1 << 2;
const FLAG_UNSLASHED = 1 << 6;
const FLAG_ELIGIBLE_ATTESTER = 1 << 7;

const FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
const FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
const FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;

interface IRewardPenaltyItem {
  baseReward: number;
  proposerReward: number;
  maxAttesterReward: number;
  sourceCheckpointReward: number;
  targetCheckpointReward: number;
  headReward: number;
  basePenalty: number;
  finalityDelayPenalty: number;
}

/**
 * Return attestation reward/penalty deltas for each validator.
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
export function getAttestationDeltas(state: CachedBeaconStatePhase0, epochProcess: EpochProcess): [number[], number[]] {
  const validatorCount = epochProcess.statuses.length;
  const rewards = newZeroedArray(validatorCount);
  const penalties = newZeroedArray(validatorCount);

  // no need this as we make sure it in EpochProcess
  // let totalBalance = bigIntMax(epochProcess.totalActiveStake, increment);
  const totalBalance = epochProcess.totalActiveStakeByIncrement;
  const totalBalanceInGwei = BigInt(totalBalance) * BigInt(EFFECTIVE_BALANCE_INCREMENT);

  // increment is factored out from balance totals to avoid overflow
  const prevEpochSourceStakeByIncrement = epochProcess.prevEpochUnslashedStake.sourceStakeByIncrement;
  const prevEpochTargetStakeByIncrement = epochProcess.prevEpochUnslashedStake.targetStakeByIncrement;
  const prevEpochHeadStakeByIncrement = epochProcess.prevEpochUnslashedStake.headStakeByIncrement;

  // sqrt first, before factoring out the increment for later usage
  const balanceSqRoot = bnToNum(bigIntSqrt(totalBalanceInGwei));
  const finalityDelay = epochProcess.prevEpoch - state.finalizedCheckpoint.epoch;

  const BASE_REWARDS_PER_EPOCH = BASE_REWARDS_PER_EPOCH_CONST;
  const proposerRewardQuotient = PROPOSER_REWARD_QUOTIENT;
  const isInInactivityLeak = finalityDelay > MIN_EPOCHS_TO_INACTIVITY_PENALTY;

  // effectiveBalance is multiple of EFFECTIVE_BALANCE_INCREMENT and less than MAX_EFFECTIVE_BALANCE
  // so there are limited values of them like 32, 31, 30
  const rewardPnaltyItemCache = new Map<number, IRewardPenaltyItem>();
  const {statuses} = epochProcess;
  const {effectiveBalanceIncrements} = state.epochCtx;
  for (let i = 0; i < statuses.length; i++) {
    const effectiveBalanceIncrement = effectiveBalanceIncrements[i];
    const effectiveBalance = effectiveBalanceIncrement * EFFECTIVE_BALANCE_INCREMENT;
    const status = statuses[i];

    let rewardItem = rewardPnaltyItemCache.get(effectiveBalanceIncrement);
    if (!rewardItem) {
      const baseReward = Math.floor(
        Math.floor((effectiveBalance * BASE_REWARD_FACTOR) / balanceSqRoot) / BASE_REWARDS_PER_EPOCH
      );
      const proposerReward = Math.floor(baseReward / proposerRewardQuotient);
      rewardItem = {
        baseReward,
        proposerReward,
        maxAttesterReward: baseReward - proposerReward,
        sourceCheckpointReward: isInInactivityLeak
          ? baseReward
          : Math.floor((baseReward * prevEpochSourceStakeByIncrement) / totalBalance),
        targetCheckpointReward: isInInactivityLeak
          ? baseReward
          : Math.floor((baseReward * prevEpochTargetStakeByIncrement) / totalBalance),
        headReward: isInInactivityLeak
          ? baseReward
          : Math.floor((baseReward * prevEpochHeadStakeByIncrement) / totalBalance),
        basePenalty: baseReward * BASE_REWARDS_PER_EPOCH_CONST - proposerReward,
        finalityDelayPenalty: Math.floor((effectiveBalance * finalityDelay) / INACTIVITY_PENALTY_QUOTIENT),
      };
      rewardPnaltyItemCache.set(effectiveBalanceIncrement, rewardItem);
    }

    const {
      baseReward,
      proposerReward,
      maxAttesterReward,
      sourceCheckpointReward,
      targetCheckpointReward,
      headReward,
      basePenalty,
      finalityDelayPenalty,
    } = rewardItem;

    // inclusion speed bonus
    if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED)) {
      rewards[status.proposerIndex] += proposerReward;
      rewards[i] += Math.floor(maxAttesterReward / status.inclusionDelay);
    }

    if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      // expected FFG source
      if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED)) {
        // justification-participation reward
        rewards[i] += sourceCheckpointReward;
      } else {
        // justification-non-participation R-penalty
        penalties[i] += baseReward;
      }

      // expected FFG target
      if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
        // boundary-attestation reward
        rewards[i] += targetCheckpointReward;
      } else {
        // boundary-attestation-non-participation R-penalty
        penalties[i] += baseReward;
      }

      // expected head
      if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED)) {
        // canonical-participation reward
        rewards[i] += headReward;
      } else {
        // non-canonical-participation R-penalty
        penalties[i] += baseReward;
      }

      // take away max rewards if we're not finalizing
      if (isInInactivityLeak) {
        penalties[i] += basePenalty;

        if (!hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
          penalties[i] += finalityDelayPenalty;
        }
      }
    }
  }

  return [rewards, penalties];
}
