/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";

import {BeaconState, Gwei} from "../../../../types";
import {IBeaconConfig} from "../../../../config";

import {
  getAttestingIndices,
  getPreviousEpoch,
  getTotalActiveBalance,
  isActiveValidator,
  getTotalBalance,
} from "../../util";

import {
  getAttestingBalance,
  getMatchingHeadAttestations,
  getMatchingSourceAttestations,
  getMatchingTargetAttestations,
  getUnslashedAttestingIndices,
} from "../util";

import {getBaseReward} from "./baseReward";


export function getAttestationDeltas(config: IBeaconConfig, state: BeaconState): [Gwei[], Gwei[]] {
  const previousEpoch = getPreviousEpoch(config, state);
  const totalBalance = getTotalActiveBalance(config, state);
  const rewards = Array.from({length: state.validators.length}, () => new BN(0));
  const penalties = Array.from({length: state.validators.length}, () => new BN(0));
  const eligibleValidatorIndices = state.validators
    .reduce((indices, v, index) => {
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
          rewards[index] = rewards[index]
            .add(getBaseReward(config, state, index).mul(attestingBalance).div(totalBalance));
        } else {
          penalties[index] = penalties[index]
            .add(getBaseReward(config, state, index));
        }
      });
    });
  // Proposer and inclusion delay micro-rewards
  getUnslashedAttestingIndices(config, state, matchingSourceAttestations).forEach((index) => {
    const earliestAttestation = matchingSourceAttestations
      .filter((a) => getAttestingIndices(config, state, a.data, a.aggregationBits).includes(index))
      .reduce((a1, a2) => a2.inclusionDelay < a1.inclusionDelay ? a2 : a1);
    const baseReward = getBaseReward(config, state, index);
    const proposerReward = baseReward.divn(config.params.PROPOSER_REWARD_QUOTIENT);
    rewards[earliestAttestation.proposerIndex] = rewards[earliestAttestation.proposerIndex]
      .add(proposerReward);
    const maxAttesterReward = baseReward.sub(proposerReward);
    rewards[index] = rewards[index]
      .add(
        maxAttesterReward.muln(
          config.params.SLOTS_PER_EPOCH +
          config.params.MIN_ATTESTATION_INCLUSION_DELAY -
          earliestAttestation.inclusionDelay
        ).divn(config.params.SLOTS_PER_EPOCH));
  });

  // Inactivity penalty
  const finalityDelay = previousEpoch - state.finalizedCheckpoint.epoch;
  if (finalityDelay > config.params.MIN_EPOCHS_TO_INACTIVITY_PENALTY) {
    const matchingTargetAttestingIndices =
      getUnslashedAttestingIndices(config, state, matchingTargetAttestations);
    eligibleValidatorIndices.forEach((index) => {
      penalties[index] = penalties[index]
        .add(getBaseReward(config, state, index).muln(config.params.BASE_REWARDS_PER_EPOCH));
      if (!matchingTargetAttestingIndices.includes(index)) {
        penalties[index] = penalties[index]
          .add(
            state.validators[index].effectiveBalance
              .muln(finalityDelay)
              .div(config.params.INACTIVITY_PENALTY_QUOTIENT));
      }
    });
  }
  return [rewards, penalties];
}
