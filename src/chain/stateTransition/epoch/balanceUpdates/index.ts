import BN  from "bn.js";
import {processAttestationInclusion} from "./attestation";
import {BeaconState, Epoch, PendingAttestation, ValidatorIndex} from "../../../../types";
import {processJustificationAndFinalization} from "./justification";
import {processCrosslinksRewards} from "./crosslinks";
import {BASE_REWARD_QUOTIENT, INACTIVITY_PENALTY_QUOTIENT} from "../../../../constants";
import {getEffectiveBalance} from "../../../helpers/stateTransitionHelpers";

export function processRewardsAndPenalties(
  state: BeaconState,
  currentEpoch: Epoch,
  nextEpoch: Epoch,
  previousEpoch: Epoch,
  previousTotalBalance: BN,
  previousEpochAttestations: PendingAttestation[],
  previousEpochAttesterIndices: ValidatorIndex[],
  previousEpochBoundaryAttesterIndices: ValidatorIndex[],
  previousEpochHeadAttesterIndices: ValidatorIndex[],
  previousEpochAttestingBalance: BN,
  previousEpochBoundaryAttestingBalance: BN,
  previousEpochHeadAttestingBalance: BN): void {

  // Rewards and penalties helpers
  const baseRewardQuotient = previousTotalBalance.sqr().divn(BASE_REWARD_QUOTIENT);
  const baseReward = (state: BeaconState, index: ValidatorIndex) => getEffectiveBalance(state, index).div(baseRewardQuotient).divn(5);
  const inactivityPenalty = (state: BeaconState, index: ValidatorIndex, epochsSinceFinality: Epoch): BN => {
    return baseReward(state, index)
      .add(getEffectiveBalance(state, index))
      .muln(epochsSinceFinality)
      .divn(INACTIVITY_PENALTY_QUOTIENT)
      .divn(2);
  };

  processJustificationAndFinalization(
    state,
    currentEpoch,
    previousEpoch,
    previousEpochAttesterIndices,
    nextEpoch,
    previousTotalBalance,
    previousEpochBoundaryAttesterIndices,
    previousEpochHeadAttesterIndices,
    previousEpochAttestingBalance,
    previousEpochBoundaryAttestingBalance,
    previousEpochHeadAttestingBalance,
    baseReward,
    inactivityPenalty,
  );

  processAttestationInclusion(
    state,
    previousEpochAttestations,
    previousEpochAttesterIndices,
    baseReward,
  );

  processCrosslinksRewards(
    state,
  )
}
