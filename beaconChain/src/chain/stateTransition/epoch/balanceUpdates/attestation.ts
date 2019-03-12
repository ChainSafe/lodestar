import {BeaconState, PendingAttestation} from "../../../../types";
import {getBeaconProposerIndex} from "../../../helpers/stateTransitionHelpers";
import {ATTESTATION_INCLUSION_REWARD_QUOTIENT} from "../../../../constants";
import {inclusionSlot} from "../helpers";

export function processAttestationInclusion(state: BeaconState, previousEpochAttestations: PendingAttestation[], previousEpochAttesterIndices, baseReward: Function): void {
  for (let index of previousEpochAttesterIndices) {
    const proposerIndex = getBeaconProposerIndex(state, inclusionSlot(state, previousEpochAttestations, index));
    state.validatorBalances[proposerIndex] = state.validatorBalances[proposerIndex].add(baseReward(state, index)).divn(ATTESTATION_INCLUSION_REWARD_QUOTIENT);
  }
}
