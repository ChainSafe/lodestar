import {BeaconState, Gwei} from "@chainsafe/lodestar-types";
import {bigIntSqrt, bigIntMax} from "@chainsafe/lodestar-utils";

import {
  EpochContext, IEpochProcess,
  hasMarkers,
  FLAG_ELIGIBLE_ATTESTER, FLAG_UNSLASHED,
  FLAG_PREV_SOURCE_ATTESTER, FLAG_PREV_TARGET_ATTESTER, FLAG_PREV_HEAD_ATTESTER,
} from "../util";

export function getAttestationDeltas(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: BeaconState
): [Gwei[], Gwei[]] {
  const params = epochCtx.config.params;
  const validatorCount = process.statuses.length;
  const rewards = Array.from({length: validatorCount}, () => BigInt(0));
  const penalties = Array.from({length: validatorCount}, () => BigInt(0));

  const increment = params.EFFECTIVE_BALANCE_INCREMENT;
  let totalBalance = bigIntMax(process.totalActiveStake, increment);

  // increment is factored out from balance totals to avoid overflow
  const prevEpochSourceStake = bigIntMax(process.prevEpochUnslashedStake.sourceStake, increment) / increment;
  const prevEpochTargetStake = bigIntMax(process.prevEpochUnslashedStake.targetStake, increment) / increment;
  const prevEpochHeadStake = bigIntMax(process.prevEpochUnslashedStake.headStake, increment) / increment;

  // sqrt first, before factoring out the increment for later usage
  const balanceSqRoot = bigIntSqrt(totalBalance);
  const finalityDelay = BigInt(process.prevEpoch - state.finalizedCheckpoint.epoch);

  totalBalance = totalBalance / increment;

  const BASE_REWARD_FACTOR = BigInt(params.BASE_REWARD_FACTOR);
  const BASE_REWARDS_PER_EPOCH = BigInt(params.BASE_REWARDS_PER_EPOCH);
  const PROPOSER_REWARD_QUOTIENT = BigInt(params.PROPOSER_REWARD_QUOTIENT);
  const MIN_EPOCHS_TO_INACTIVITY_PENALTY = params.MIN_EPOCHS_TO_INACTIVITY_PENALTY;
  const INACTIVITY_PENALTY_QUOTIENT = params.INACTIVITY_PENALTY_QUOTIENT;
  const isInInactivityLeak = finalityDelay > MIN_EPOCHS_TO_INACTIVITY_PENALTY;

  process.statuses.forEach((status, i) => {
    const effBalance = status.validator.effectiveBalance;
    const baseReward = effBalance * BASE_REWARD_FACTOR / balanceSqRoot / BASE_REWARDS_PER_EPOCH;
    const proposerReward = baseReward / PROPOSER_REWARD_QUOTIENT;

    // inclusion speed bonus
    if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED)) {
      rewards[status.proposerIndex] += proposerReward;
      const maxAttesterReward = baseReward - proposerReward;
      rewards[i] += maxAttesterReward / BigInt(status.inclusionDelay);
    }
    if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      // expected FFG source
      if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED)) {
        // justification-participation reward
        rewards[i] += isInInactivityLeak? baseReward :
          baseReward * BigInt(prevEpochSourceStake) / totalBalance;

      } else {
        // justification-non-participation R-penalty
        penalties[i] += baseReward;
      }

      // expected FFG target
      if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED)) {
        // boundary-attestation reward
        rewards[i] += isInInactivityLeak? baseReward :
          baseReward * BigInt(prevEpochTargetStake) / totalBalance;
      } else {
        // boundary-attestation-non-participation R-penalty
        penalties[i] += baseReward;
      }

      // expected head
      if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED)) {
        // canonical-participation reward
        rewards[i] += isInInactivityLeak? baseReward :
          baseReward * BigInt(prevEpochHeadStake) / totalBalance;
      } else {
        // non-canonical-participation R-penalty
        penalties[i] += baseReward;
      }

      // take away max rewards if we're not finalizing
      if (isInInactivityLeak) {
        penalties[i] += baseReward * BASE_REWARDS_PER_EPOCH - proposerReward;

        if (!hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED)) {
          penalties[i] += effBalance * finalityDelay / INACTIVITY_PENALTY_QUOTIENT;
        }
      }
    }
  });
  return [rewards, penalties];
}
