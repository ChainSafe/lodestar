import {phase0} from "@chainsafe/lodestar-types";
import {bigIntSqrt, bigIntMax} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH as BASE_REWARDS_PER_EPOCH_CONST} from "../../constants";
import {newZeroedArray} from "../../util";
import {IEpochProcess, hasMarkers, CachedBeaconState} from "../../allForks/util";
import {
  BASE_REWARD_FACTOR,
  EFFECTIVE_BALANCE_INCREMENT,
  INACTIVITY_PENALTY_QUOTIENT,
  MIN_EPOCHS_TO_INACTIVITY_PENALTY,
  PROPOSER_REWARD_QUOTIENT,
} from "@chainsafe/lodestar-params";

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
export function getAttestationDeltas(
  state: CachedBeaconState<phase0.BeaconState>,
  epochProcess: IEpochProcess
): [number[], number[]] {
  const {epochCtx} = state;
  const validatorCount = epochProcess.statusesFlat.length;
  const rewards = newZeroedArray(validatorCount);
  const penalties = newZeroedArray(validatorCount);

  const increment = EFFECTIVE_BALANCE_INCREMENT;
  let totalBalance = bigIntMax(epochProcess.totalActiveStake, increment);

  // increment is factored out from balance totals to avoid overflow
  const prevEpochSourceStake = bigIntMax(epochProcess.prevEpochUnslashedStake.sourceStake, increment) / increment;
  const prevEpochTargetStake = bigIntMax(epochProcess.prevEpochUnslashedStake.targetStake, increment) / increment;
  const prevEpochHeadStake = bigIntMax(epochProcess.prevEpochUnslashedStake.headStake, increment) / increment;

  // sqrt first, before factoring out the increment for later usage
  const balanceSqRoot = bigIntSqrt(totalBalance);
  const finalityDelay = BigInt(epochProcess.prevEpoch - state.finalizedCheckpoint.epoch);

  totalBalance = totalBalance / increment;

  const BASE_REWARDS_PER_EPOCH = BigInt(BASE_REWARDS_PER_EPOCH_CONST);
  const proposerRewardQuotient = Number(PROPOSER_REWARD_QUOTIENT);
  const isInInactivityLeak = finalityDelay > MIN_EPOCHS_TO_INACTIVITY_PENALTY;

  // effectiveBalance is multiple of EFFECTIVE_BALANCE_INCREMENT and less than MAX_EFFECTIVE_BALANCE
  // so there are limited values of them like 32000000000, 31000000000, 30000000000
  const rewardPnaltyItemCache = new Map<number, IRewardPenaltyItem>();
  for (const [i, status] of epochProcess.statusesFlat.entries()) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const effBalance = epochCtx.effectiveBalances.get(i)!;
    let rewardItem = rewardPnaltyItemCache.get(Number(effBalance));
    if (!rewardItem) {
      const baseReward = Number((effBalance * BASE_REWARD_FACTOR) / balanceSqRoot / BASE_REWARDS_PER_EPOCH);
      const proposerReward = Math.floor(baseReward / proposerRewardQuotient);
      rewardItem = {
        baseReward,
        proposerReward,
        maxAttesterReward: baseReward - proposerReward,
        sourceCheckpointReward: isInInactivityLeak
          ? baseReward
          : Number((BigInt(baseReward) * prevEpochSourceStake) / totalBalance),
        targetCheckpointReward: isInInactivityLeak
          ? baseReward
          : Number((BigInt(baseReward) * prevEpochTargetStake) / totalBalance),
        headReward: isInInactivityLeak ? baseReward : Number((BigInt(baseReward) * prevEpochHeadStake) / totalBalance),
        basePenalty: baseReward * BASE_REWARDS_PER_EPOCH_CONST - proposerReward,
        finalityDelayPenalty: Number((effBalance * finalityDelay) / INACTIVITY_PENALTY_QUOTIENT),
      };
      rewardPnaltyItemCache.set(Number(effBalance), rewardItem);
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
