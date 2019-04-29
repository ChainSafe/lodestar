import BN from "bn.js";

import {BeaconState, Gwei} from "../../../../types";

import {
  MIN_ATTESTATION_INCLUSION_DELAY, PROPOSER_REWARD_QUOTIENT,
  MIN_EPOCHS_TO_INACTIVITY_PENALTY, BASE_REWARDS_PER_EPOCH,
  INACTIVITY_PENALTY_QUOTIENT,
} from "../../../../constants";

import {isActiveValidator, getPreviousEpoch} from "../../util";

import {
  getAttestingBalance, getTotalActiveBalance, getMatchingSourceAttestations,
  getMatchingTargetAttestations, getMatchingHeadAttestations,
  getUnslashedAttestingIndices, getEarliestAttestation,
} from "../util";

import {getBaseReward} from "./baseReward";


export function getAttestationDeltas(state: BeaconState): [Gwei[], Gwei[]] {
  const previousEpoch = getPreviousEpoch(state);
  const totalBalance = getTotalActiveBalance(state);
  const rewards = Array.from({length: state.validatorRegistry.length}, () => new BN(0));
  const penalties = Array.from({length: state.validatorRegistry.length}, () => new BN(0));
  const eligibleValidatorIndices = state.validatorRegistry
    .reduce((indices, v, index) => {
      if (isActiveValidator(v, previousEpoch) || (v.slashed && previousEpoch + 1 < v.withdrawableEpoch)) {
        indices.push(index);
      }
      return indices;
    }, []);

  // Micro-incentives for matching FFG source, FFG target, and head
  const matchingSourceAttestations = getMatchingSourceAttestations(state, previousEpoch);
  const matchingTargetAttestations = getMatchingTargetAttestations(state, previousEpoch);
  const matchingHeadAttestations = getMatchingHeadAttestations(state, previousEpoch);
  [matchingSourceAttestations, matchingTargetAttestations, matchingHeadAttestations].forEach((attestations) => {
    const unslashedAttestingIndices = getUnslashedAttestingIndices(state, attestations);
    const attestingBalance = getAttestingBalance(state, attestations);
    eligibleValidatorIndices.forEach((index) => {
      if (unslashedAttestingIndices.includes(index)) {
        rewards[index] = rewards[index]
          .add(getBaseReward(state, index).mul(attestingBalance).div(totalBalance));
      } else {
        penalties[index] = penalties[index]
          .add(getBaseReward(state, index));
      }
    });
  });

  // Proposer and inclusion delay micro-rewards
  getUnslashedAttestingIndices(state, matchingSourceAttestations).forEach((index) => {
    const earliestAttestation = getEarliestAttestation(state, matchingSourceAttestations, index);
    rewards[earliestAttestation.proposerIndex] = rewards[earliestAttestation.proposerIndex]
      .add(getBaseReward(state, index).divn(PROPOSER_REWARD_QUOTIENT));
    const inclusionDelay = earliestAttestation.inclusionSlot - earliestAttestation.data.slot;
    rewards[index] = rewards[index]
      .add(getBaseReward(state, index).muln(MIN_ATTESTATION_INCLUSION_DELAY).divn(inclusionDelay));
  });

  // Inactivity penalty
  const finalityDelay = previousEpoch - state.finalizedEpoch;
  if (finalityDelay > MIN_EPOCHS_TO_INACTIVITY_PENALTY) {
    const matchingTargetAttestingIndices = getUnslashedAttestingIndices(state, matchingTargetAttestations);
    eligibleValidatorIndices.forEach((index) => {
      penalties[index] = penalties[index]
        .add(getBaseReward(state, index).muln(BASE_REWARDS_PER_EPOCH));
      if (!matchingTargetAttestingIndices.includes(index)) {
        penalties[index] = penalties[index]
          .add(state.validatorRegistry[index].effectiveBalance.muln(finalityDelay).divn(INACTIVITY_PENALTY_QUOTIENT));
      }
    });
  }
  return [rewards, penalties];
}
