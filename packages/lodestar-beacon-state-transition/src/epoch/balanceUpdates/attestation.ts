/**
 * @module chain/stateTransition/epoch
 */


import {BeaconState, Gwei, ValidatorIndex, PendingAttestation} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {
  getAttestingIndices,
  getPreviousEpoch,
  getTotalActiveBalance,
  getTotalBalance,
  isActiveValidator,
} from "../../util";

import {
  getMatchingHeadAttestations,
  getMatchingSourceAttestations,
  getMatchingTargetAttestations,
  getUnslashedAttestingIndices,
} from "../util";

import {getBaseReward, isInInactivityLeak, getProposerReward, getFinalityDelay} from "./util";

function getEligibleValidatorIndices(config: IBeaconConfig, state: BeaconState): ValidatorIndex[] {
  const previousEpoch = getPreviousEpoch(config, state);
  return Array.from(state.validators)
    .reduce((indices: ValidatorIndex[], v, index) => {
      if (isActiveValidator(v, previousEpoch)
        || (v.slashed && previousEpoch + 1 < v.withdrawableEpoch)) {
        indices.push(index);
      }
      return indices;
    }, []);
}

function getAttestationComponentDeltas
(config: IBeaconConfig, state: BeaconState, attestations: PendingAttestation[]): [bigint[], bigint[]] {
  const unslashedAttestingIndices = getUnslashedAttestingIndices(config, state, attestations);
  const attestingBalance = getTotalBalance(config, state, unslashedAttestingIndices);
  const rewards = Array.from({length: state.validators.length}, () => 0n);
  const penalties = Array.from({length: state.validators.length}, () => 0n);
  const totalBalance = getTotalActiveBalance(config, state);

  getEligibleValidatorIndices(config, state).forEach((index) => {
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
  });
  return [rewards, penalties];
}

function getSourceDeltas(config: IBeaconConfig, state: BeaconState): [bigint[], bigint[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const matchingSourceAttestations = getMatchingSourceAttestations(config, state, previousEpoch);
  return getAttestationComponentDeltas(config, state, matchingSourceAttestations);
}

function getTargetDeltas(config: IBeaconConfig, state: BeaconState): [bigint[], bigint[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const matchingTargetAttestations = getMatchingTargetAttestations(config, state, previousEpoch);
  return getAttestationComponentDeltas(config, state, matchingTargetAttestations);
}

function getHeadDeltas(config: IBeaconConfig, state: BeaconState): [bigint[], bigint[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const matchingHeadAttestations = getMatchingHeadAttestations(config, state, previousEpoch);
  return getAttestationComponentDeltas(config, state, matchingHeadAttestations);
}

function getInclusionDelayDeltas(config: IBeaconConfig, state: BeaconState): bigint[] {
  const previousEpoch = getPreviousEpoch(config, state);
  const rewards = Array.from({length: state.validators.length}, () => 0n);
  const matchingSourceAttestations = getMatchingSourceAttestations(config, state, previousEpoch);
  getUnslashedAttestingIndices(config, state, matchingSourceAttestations).forEach((index) => {
    const earliestAttestation = matchingSourceAttestations
      .filter((a) => getAttestingIndices(config, state, a.data, a.aggregationBits).includes(index))
      .reduce((a1, a2) => a2.inclusionDelay < a1.inclusionDelay ? a2 : a1);

    const baseReward = getBaseReward(config, state, index);
    rewards[earliestAttestation.proposerIndex] += getProposerReward(config, state, index);
    const maxAttesterReward = BigInt(baseReward - getProposerReward(config, state, index));
    rewards[index] += BigInt(maxAttesterReward / BigInt(earliestAttestation.inclusionDelay));
  });
  // No penalties associated with inclusion delay
  return rewards;
}

function getInactivityPenaltyDeltas(config: IBeaconConfig, state: BeaconState): bigint[] {
  const penalties = Array.from({length: state.validators.length}, () => 0n);
  const previousEpoch = getPreviousEpoch(config, state);
  const matchingTargetAttestations = getMatchingTargetAttestations(config, state, previousEpoch);
  if (isInInactivityLeak(config, state)) {
    const matchingTargetAttestingIndices =
    getUnslashedAttestingIndices(config, state, matchingTargetAttestations);
    getEligibleValidatorIndices(config, state).forEach((index) => {
      const baseReward = getBaseReward(config, state, index);
      penalties[index] += BigInt(config.params.BASE_REWARDS_PER_EPOCH) * baseReward -
        getProposerReward(config, state, index);
      if (!matchingTargetAttestingIndices.includes(index)) {
        penalties[index] += (
          state.validators[index].effectiveBalance
              * BigInt(getFinalityDelay(config, state)) / config.params.INACTIVITY_PENALTY_QUOTIENT);
      }
    });
  }
  // No rewards associated with inactivity penalties
  return penalties;
}


export function getAttestationDeltas(config: IBeaconConfig, state: BeaconState): [Gwei[], Gwei[]] {
  const [sourceRewards, sourcePenalties] = getSourceDeltas(config, state);
  const [targetRewards, targetPenalties] = getTargetDeltas(config, state);
  const [headRewards, headPenalties] = getHeadDeltas(config, state);
  const inclusionDelayRewards = getInclusionDelayDeltas(config, state);
  const inactivityPenalties = getInactivityPenaltyDeltas(config, state);
  const rewards = [sourceRewards, targetRewards, headRewards, inclusionDelayRewards]
    .reduce((previousValue, currentValue) => {
      previousValue.forEach((_, index) => previousValue[index] += currentValue[index]);
      return previousValue;
    });
  const penalties = [sourcePenalties, targetPenalties, headPenalties, inactivityPenalties]
    .reduce((previousValue, currentValue) => {
      previousValue.forEach((_, index) => previousValue[index] += currentValue[index]);
      return previousValue;
    });
  return [rewards, penalties];
}
