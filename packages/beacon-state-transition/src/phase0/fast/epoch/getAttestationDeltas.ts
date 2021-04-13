import {phase0} from "@chainsafe/lodestar-types";
import {bigIntSqrt, bigIntMax} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH as BASE_REWARDS_PER_EPOCH_CONST} from "../../../constants";

import {IEpochProcess, CachedBeaconState} from "../../../fast";
import {isActiveValidator} from "../../../util";
import {newZeroedArray} from "../../../util/array";

/**
 * Return attestation reward/penalty deltas for each validator.
 */
export function getAttestationDeltas(
  state: CachedBeaconState<phase0.BeaconState>,
  process: IEpochProcess
): [number[], number[]] {
  const {config, validators} = state;
  const params = config.params;
  const validatorCount = validators.length;
  const rewards = newZeroedArray(validatorCount);
  const penalties = newZeroedArray(validatorCount);
  const previousEpoch = state.previousShuffling.epoch;

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
  const BASE_REWARDS_PER_EPOCH = BigInt(BASE_REWARDS_PER_EPOCH_CONST);
  const MIN_EPOCHS_TO_INACTIVITY_PENALTY = params.MIN_EPOCHS_TO_INACTIVITY_PENALTY;
  const INACTIVITY_PENALTY_QUOTIENT = params.INACTIVITY_PENALTY_QUOTIENT;
  const isInInactivityLeak = finalityDelay > MIN_EPOCHS_TO_INACTIVITY_PENALTY;

  const flatValidators = validators.persistent.toArray();
  const flatPreviousEpochParticipation = state.previousEpochParticipation.persistent.toArray();
  const flatPreviousInclusionData = state.previousInclusionData!.toArray();
  for (let i = 0; i < flatValidators.length; i++) {
    const validator = flatValidators[i];
    const previousParticipation = flatPreviousEpochParticipation[i];
    const previousInclusionData = flatPreviousInclusionData[i];

    const effBalance = validator.effectiveBalance;
    const baseReward = Number((effBalance * BASE_REWARD_FACTOR) / balanceSqRoot / BASE_REWARDS_PER_EPOCH);
    const proposerReward = Math.floor(baseReward / params.PROPOSER_REWARD_QUOTIENT);

    // inclusion delay rewards
    if (previousParticipation.timelySource && !validator.slashed) {
      rewards[previousInclusionData.proposerIndex] += proposerReward;
      const maxAttesterReward = baseReward - proposerReward;
      rewards[i] += Math.floor(maxAttesterReward / previousInclusionData.inclusionDelay);
    }

    // if the validator is eligible
    if (
      isActiveValidator(validator, previousEpoch) ||
      (validator.slashed && previousEpoch + 1 < validator.withdrawableEpoch)
    ) {
      if (validator.slashed) {
        // mul by 3 for the three participation flags: source, target, head
        penalties[i] += baseReward * 3;
        if (isInInactivityLeak) {
          penalties[i] += baseReward * BASE_REWARDS_PER_EPOCH_CONST - proposerReward;
        }
      } else {
        // expected FFG source
        if (previousParticipation.timelySource) {
          // justification-participation reward
          rewards[i] += isInInactivityLeak
            ? baseReward
            : Number((BigInt(baseReward) * prevEpochSourceStake) / totalBalance);
        } else {
          penalties[i] += baseReward;
        }

        // expected FFG target
        if (previousParticipation.timelyTarget) {
          // boundary-attestation reward
          rewards[i] += isInInactivityLeak
            ? baseReward
            : Number((BigInt(baseReward) * prevEpochTargetStake) / totalBalance);
        } else {
          // boundary-attestation-non-participation R-penalty
          penalties[i] += baseReward;
        }

        // expected head
        if (previousParticipation.timelyHead) {
          // canonical-participation reward
          rewards[i] += isInInactivityLeak
            ? baseReward
            : Number((BigInt(baseReward) * prevEpochHeadStake) / totalBalance);
        } else {
          // non-canonical-participation R-penalty
          penalties[i] += baseReward;
        }

        // take away max rewards if we're not finalizing
        if (isInInactivityLeak) {
          penalties[i] += baseReward * BASE_REWARDS_PER_EPOCH_CONST - proposerReward;

          if (!previousParticipation.timelyTarget) {
            penalties[i] += Number((effBalance * finalityDelay) / INACTIVITY_PENALTY_QUOTIENT);
          }
        }
      }
    }
  }
  return [rewards, penalties];
}
