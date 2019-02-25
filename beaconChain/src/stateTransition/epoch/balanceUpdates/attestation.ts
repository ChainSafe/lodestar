import {BeaconState} from "../../../../types";
import {getBeaconProposerIndex} from "../../../../helpers/stateTransitionHelpers";
import {ATTESTATION_INCLUSION_REWARD_QUOTIENT} from "../../../../constants";

export function processAttestationInclusion(state: BeaconState, previousEpochAttesterIndices, baseReward: Function): void {
  for (let index of previousEpochAttesterIndices) {
    const proposerIndex = getBeaconProposerIndex(state, inclusionSlot(state, index));
    state.validatorBalances[proposerIndex] = state.validatorBalances[proposerIndex].add(baseReward(state, index)).divn(ATTESTATION_INCLUSION_REWARD_QUOTIENT);
  }
}
