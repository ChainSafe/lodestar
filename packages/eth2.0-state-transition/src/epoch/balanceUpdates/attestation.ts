/**
 * @module chain/stateTransition/epoch
 */


import {BeaconState, Gwei, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

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

import {getBaseReward} from "./baseReward";


export function getAttestationDeltas(config: IBeaconConfig, state: BeaconState): [Gwei[], Gwei[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const totalBalance = getTotalActiveBalance(config, state);
  const rewards = Array.from({length: state.validators.length}, () => 0n);
  const penalties = Array.from({length: state.validators.length}, () => 0n);
  const eligibleValidatorIndices = state.validators
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
      const attestingBalance = getTotalBalance(state, unslashedAttestingIndices);
      eligibleValidatorIndices.forEach((index) => {
        if (unslashedAttestingIndices.includes(index)) {
          rewards[index] += (getBaseReward(config, state, index) * attestingBalance / totalBalance);
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
    const proposerReward = baseReward / BigInt(config.params.PROPOSER_REWARD_QUOTIENT);
    rewards[earliestAttestation.proposerIndex] += proposerReward;
    const maxAttesterReward = baseReward - proposerReward;
    rewards[index] += (
          maxAttesterReward * BigInt(
            config.params.SLOTS_PER_EPOCH +
          config.params.MIN_ATTESTATION_INCLUSION_DELAY -
          earliestAttestation.inclusionDelay
          ) / BigInt(config.params.SLOTS_PER_EPOCH));
  });

  // Inactivity penalty
  const finalityDelay = previousEpoch - state.finalizedCheckpoint.epoch;
  if (finalityDelay > config.params.MIN_EPOCHS_TO_INACTIVITY_PENALTY) {
    const matchingTargetAttestingIndices =
      getUnslashedAttestingIndices(config, state, matchingTargetAttestations);
    eligibleValidatorIndices.forEach((index) => {
      penalties[index] = (penalties[index] + getBaseReward(config, state, index))
        * BigInt(config.params.BASE_REWARDS_PER_EPOCH);
      if (!matchingTargetAttestingIndices.includes(index)) {
        penalties[index] += (
          state.validators[index].effectiveBalance
             * BigInt(finalityDelay) / config.params.INACTIVITY_PENALTY_QUOTIENT);
      }
    });
  }
  return [rewards, penalties];
}
