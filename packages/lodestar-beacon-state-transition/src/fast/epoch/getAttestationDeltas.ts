import {BeaconState, Gwei} from "@chainsafe/lodestar-types";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";

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

  let totalBalance = process.totalActiveStake;
  if (totalBalance === BigInt(0)) {
    totalBalance = BigInt(1);
  }

  const increment = params.EFFECTIVE_BALANCE_INCREMENT;
  const prevEpochSourceStake = process.prevEpochUnslashedStake.sourceStake / increment;
  const prevEpochTargetStake = process.prevEpochUnslashedStake.targetStake / increment;
  const prevEpochHeadStake = process.prevEpochUnslashedStake.headStake / increment;

  const balanceSqRoot = bigIntSqrt(totalBalance);
  const finalityDelay = BigInt(process.prevEpoch - state.finalizedCheckpoint.epoch);

  totalBalance = totalBalance / increment;

  const BASE_REWARD_FACTOR = BigInt(params.BASE_REWARD_FACTOR);
  const BASE_REWARDS_PER_EPOCH = BigInt(params.BASE_REWARDS_PER_EPOCH);
  const PROPOSER_REWARD_QUOTIENT = BigInt(params.PROPOSER_REWARD_QUOTIENT);
  const MIN_EPOCHS_TO_INACTIVITY_PENALTY = params.MIN_EPOCHS_TO_INACTIVITY_PENALTY;
  const INACTIVITY_PENALTY_QUOTIENT = params.INACTIVITY_PENALTY_QUOTIENT;

  process.statuses.forEach((status, i) => {
    if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      const effBalance = status.validator.effectiveBalance;
      const baseReward = effBalance * BASE_REWARD_FACTOR / balanceSqRoot / BASE_REWARDS_PER_EPOCH;

      // expected FFG source
      if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED)) {
        // justification-participation reward
        rewards[i] += baseReward * prevEpochSourceStake / totalBalance;

        // inclusion speed bonus
        const proposerReward = baseReward / PROPOSER_REWARD_QUOTIENT;
        rewards[status.proposerIndex] += proposerReward;
        const maxAttesterReward = baseReward - proposerReward;
        rewards[i] += maxAttesterReward / BigInt(status.inclusionDelay);
      } else {
        // justification-non-participation R-penalty
        penalties[i] += baseReward;
      }

      // expected FFG target
      if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED)) {
        // boundary-attestation reward
        rewards[i] += baseReward * prevEpochTargetStake / totalBalance;
      } else {
        // boundary-attestation-non-participation R-penalty
        penalties[i] += baseReward;
      }

      // expected head
      if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED)) {
        // canonical-participation reward
        rewards[i] += baseReward * prevEpochHeadStake / totalBalance;
      } else {
        // non-canonical-participation R-penalty
        penalties[i] += baseReward;
      }

      // take away max rewards if we're not finalizing
      if (finalityDelay > MIN_EPOCHS_TO_INACTIVITY_PENALTY) {
        penalties[i] += baseReward * BASE_REWARDS_PER_EPOCH;
        if (!hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED)) {
          penalties[i] += effBalance * finalityDelay / INACTIVITY_PENALTY_QUOTIENT;
        }
      }
    }
  });
  return [rewards, penalties];
}
