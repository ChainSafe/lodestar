/**
 * @module chain/stateTransition/epoch
 */


import {BeaconState, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
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


export function getAttestationDeltas(config: IBeaconConfig, state: BeaconState): [Gwei[], Gwei[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const totalBalance = getTotalActiveBalance(config, state);
  const rewards = Array.from({length: state.validators.length}, () => 0n);
  const penalties = Array.from({length: state.validators.length}, () => 0n);
  const eligibleValidatorIndices = Array.from(state.validators)
    .reduce((indices: ValidatorIndex[], v, index) => {
      if (isActiveValidator(v, previousEpoch)
        || (v.slashed && previousEpoch + 1 < v.withdrawableEpoch)) {
        indices.push(index);
      }
      return indices;
    }, []);

  // Micro-incentives for matching FFG source, FFG target, and head
  const matchingSourceAttestations = getMatchingSourceAttestations(config, state, previousEpoch);
  const matchingTargetAttestations = getMatchingTargetAttestations(config, state, previousEpoch);
  const matchingHeadAttestations = getMatchingHeadAttestations(config, state, previousEpoch);
  [matchingSourceAttestations, matchingTargetAttestations, matchingHeadAttestations]
    .forEach((attestations) => {
      const unslashedAttestingIndices = getUnslashedAttestingIndices(config, state, attestations);
      const attestingBalance = getTotalBalance(config, state, unslashedAttestingIndices);
      eligibleValidatorIndices.forEach((index) => {
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
    });
  // Proposer and inclusion delay micro-rewards
  getUnslashedAttestingIndices(config, state, matchingSourceAttestations).forEach((index) => {
    const earliestAttestation = matchingSourceAttestations
      .filter((a) => getAttestingIndices(config, state, a.data, a.aggregationBits).includes(index))
      .reduce((a1, a2) => a2.inclusionDelay < a1.inclusionDelay ? a2 : a1);

    const baseReward = getBaseReward(config, state, index);
    rewards[earliestAttestation.proposerIndex] += getProposerReward(config, state, index);
    const maxAttesterReward = BigInt(baseReward - getProposerReward(config, state, index));
    rewards[index] += BigInt(maxAttesterReward / BigInt(earliestAttestation.inclusionDelay));
  });

  // Inactivity penalty
  if (isInInactivityLeak(config, state)) {
    const matchingTargetAttestingIndices =
      getUnslashedAttestingIndices(config, state, matchingTargetAttestations);
    eligibleValidatorIndices.forEach((index) => {
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
  return [rewards, penalties];
}
