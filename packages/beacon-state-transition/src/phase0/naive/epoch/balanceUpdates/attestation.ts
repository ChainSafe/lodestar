/**
 * @module chain/stateTransition/epoch
 */

import {Gwei, ValidatorIndex, phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BASE_REWARDS_PER_EPOCH} from "../../../../constants";

import {
  getAttestingIndices,
  getPreviousEpoch,
  getTotalActiveBalance,
  getTotalBalance,
  isActiveValidator,
} from "../../../../util";

import {
  getMatchingHeadAttestations,
  getMatchingSourceAttestations,
  getMatchingTargetAttestations,
  getUnslashedAttestingIndices,
} from "../util";

import {getBaseReward, isInInactivityLeak, getProposerReward, getFinalityDelay} from "./util";

/**
 * Both active validators and slashed-but-not-yet-withdrawn validators are eligible to receive
 * penalties. This is done to prevent self-slashing from being a way to escape inactivity leaks.
 */
export function getEligibleValidatorIndices(config: IBeaconConfig, state: phase0.BeaconState): ValidatorIndex[] {
  const previousEpoch = getPreviousEpoch(config, state);
  return Array.from(state.validators).reduce((indices: ValidatorIndex[], v, index) => {
    if (isActiveValidator(v, previousEpoch) || (v.slashed && previousEpoch + 1 < v.withdrawableEpoch)) {
      indices.push(index);
    }
    return indices;
  }, []);
}

/**
 * Helper with shared logic for use by get source, target, and head deltas functions
 */
export function getAttestationComponentDeltas(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  attestations: phase0.PendingAttestation[]
): [bigint[], bigint[]] {
  const unslashedAttestingIndices = getUnslashedAttestingIndices(config, state, attestations);
  const attestingBalance = getTotalBalance(config, state, unslashedAttestingIndices);
  const rewards = Array.from({length: state.validators.length}, () => BigInt(0));
  const penalties = Array.from({length: state.validators.length}, () => BigInt(0));
  const totalBalance = getTotalActiveBalance(config, state);

  for (const index of getEligibleValidatorIndices(config, state)) {
    if (unslashedAttestingIndices.includes(index)) {
      const increment = BigInt(config.params.EFFECTIVE_BALANCE_INCREMENT);
      if (isInInactivityLeak(config, state)) {
        // optimal participation receives full base reward compensation here.
        rewards[index] += getBaseReward(config, state, index);
      } else {
        const rewardNumerator = BigInt(getBaseReward(config, state, index) * (attestingBalance / increment));
        rewards[index] += BigInt(rewardNumerator / (totalBalance / increment));
      }
    } else {
      penalties[index] += getBaseReward(config, state, index);
    }
  }

  return [rewards, penalties];
}

/**
 * Return attester micro-rewards/penalties for source-vote for each validator.
 */
export function getSourceDeltas(config: IBeaconConfig, state: phase0.BeaconState): [bigint[], bigint[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const matchingSourceAttestations = getMatchingSourceAttestations(config, state, previousEpoch);
  return getAttestationComponentDeltas(config, state, matchingSourceAttestations);
}

/**
 * Return attester micro-rewards/penalties for target-vote for each validator.
 */
export function getTargetDeltas(config: IBeaconConfig, state: phase0.BeaconState): [bigint[], bigint[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const matchingTargetAttestations = getMatchingTargetAttestations(config, state, previousEpoch);
  return getAttestationComponentDeltas(config, state, matchingTargetAttestations);
}

/**
 * Return attester micro-rewards/penalties for head-vote for each validator.
 */
export function getHeadDeltas(config: IBeaconConfig, state: phase0.BeaconState): [bigint[], bigint[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const matchingHeadAttestations = getMatchingHeadAttestations(config, state, previousEpoch);
  return getAttestationComponentDeltas(config, state, matchingHeadAttestations);
}

/**
 * Return proposer and inclusion delay micro-rewards/penalties for each validator.
 */
export function getInclusionDelayDeltas(config: IBeaconConfig, state: phase0.BeaconState): bigint[] {
  const previousEpoch = getPreviousEpoch(config, state);
  const rewards = Array.from({length: state.validators.length}, () => BigInt(0));
  const matchingSourceAttestations = getMatchingSourceAttestations(config, state, previousEpoch);

  for (const index of getUnslashedAttestingIndices(config, state, matchingSourceAttestations)) {
    const earliestAttestation = matchingSourceAttestations
      .filter((a) => getAttestingIndices(config, state, a.data, a.aggregationBits).includes(index))
      .reduce((a1, a2) => (a2.inclusionDelay < a1.inclusionDelay ? a2 : a1));

    const baseReward = getBaseReward(config, state, index);
    rewards[earliestAttestation.proposerIndex] += getProposerReward(config, state, index);
    const maxAttesterReward = BigInt(baseReward - getProposerReward(config, state, index));
    rewards[index] += BigInt(maxAttesterReward / BigInt(earliestAttestation.inclusionDelay));
  }

  // No penalties associated with inclusion delay
  return rewards;
}

/**
 * Return inactivity reward/penalty deltas for each validator.
 */
export function getInactivityPenaltyDeltas(config: IBeaconConfig, state: phase0.BeaconState): bigint[] {
  const penalties = Array.from({length: state.validators.length}, () => BigInt(0));
  const previousEpoch = getPreviousEpoch(config, state);
  const matchingTargetAttestations = getMatchingTargetAttestations(config, state, previousEpoch);
  if (isInInactivityLeak(config, state)) {
    const matchingTargetAttestingIndices = getUnslashedAttestingIndices(config, state, matchingTargetAttestations);
    for (const index of getEligibleValidatorIndices(config, state)) {
      const baseReward = getBaseReward(config, state, index);
      penalties[index] += BigInt(BASE_REWARDS_PER_EPOCH) * baseReward - getProposerReward(config, state, index);
      if (!matchingTargetAttestingIndices.includes(index)) {
        penalties[index] +=
          (state.validators[index].effectiveBalance * BigInt(getFinalityDelay(config, state))) /
          config.params.INACTIVITY_PENALTY_QUOTIENT;
      }
    }
  }
  // No rewards associated with inactivity penalties
  return penalties;
}

/**
 * Return attestation reward/penalty deltas for each validator.
 */
export function getAttestationDeltas(config: IBeaconConfig, state: phase0.BeaconState): [Gwei[], Gwei[]] {
  const [sourceRewards, sourcePenalties] = getSourceDeltas(config, state);
  const [targetRewards, targetPenalties] = getTargetDeltas(config, state);
  const [headRewards, headPenalties] = getHeadDeltas(config, state);
  const inclusionDelayRewards = getInclusionDelayDeltas(config, state);
  const inactivityPenalties = getInactivityPenaltyDeltas(config, state);
  const rewards = [sourceRewards, targetRewards, headRewards, inclusionDelayRewards].reduce(
    (previousValue, currentValue) => {
      for (const index of previousValue.keys()) previousValue[index] += currentValue[index];
      return previousValue;
    }
  );
  const penalties = [sourcePenalties, targetPenalties, headPenalties, inactivityPenalties].reduce(
    (previousValue, currentValue) => {
      for (const index of previousValue.keys()) previousValue[index] += currentValue[index];
      return previousValue;
    }
  );
  return [rewards, penalties];
}
