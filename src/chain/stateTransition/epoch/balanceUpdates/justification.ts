import {getActiveValidatorIndices, isActiveValidator} from "../../../helpers/stateTransitionHelpers";
import {MIN_ATTESTATION_INCLUSION_DELAY} from "../../../../constants";
import {BeaconState, Epoch, ValidatorIndex} from "../../../../types";
import BN from "bn.js";
import {inclusionDistance} from "../helpers";

export function processJustificationAndFinalization(
  state: BeaconState,
  currentEpoch: Epoch,
  previousEpoch: Epoch,
  previousEpochAttesterIndices: ValidatorIndex[],
  nextEpoch: Epoch,
  previousTotalBalance: BN,
  previousEpochBoundaryAttesterIndices: ValidatorIndex[],
  previousEpochHeadAttesterIndices: ValidatorIndex[],
  previousEpochAttestingBalance: BN,
  previousEpochBoundaryAttestingBalance: BN,
  previousEpochHeadAttestingBalance: BN,
  baseReward: Function,
  inactivityPenalty: Function): void {

  // Justification and finalization
  const validators = getActiveValidatorIndices(state.validatorRegistry, previousEpoch);
  const epochsSinceFinality = nextEpoch - state.finalizedEpoch;

  // CASE 1
  if (epochsSinceFinality < 4) {
    // Expected FFG source
    for (let index of previousEpochAttesterIndices) {
      // IFF validator is active and they were not in previousEpochAttesterIndices slash
      if (isActiveValidator(state.validatorRegistry[index], previousEpoch) && !previousEpochAttesterIndices.includes(index)) {
        state.validatorBalances[index] = state.validatorBalances[index].sub(baseReward(state, index));
      } else {
        state.validatorBalances[index] = state.validatorBalances[index].add(baseReward(state, index).mul(previousEpochAttestingBalance).div(previousTotalBalance));
      }
    }

    // Expected FFG target
    for (let index of previousEpochBoundaryAttesterIndices) {
      // IFF validator is active and they were not in previousEpochAttesterIndices slash
      if (isActiveValidator(state.validatorRegistry[index], previousEpoch) && !previousEpochBoundaryAttesterIndices.includes(index)) {
        state.validatorBalances[index] = state.validatorBalances[index].sub(baseReward(state, index));
      } else {
        state.validatorBalances[index] = state.validatorBalances[index].add(baseReward(state, index).mul(previousEpochBoundaryAttestingBalance).div(previousTotalBalance));
      }
    }

    // Expected beacon chain head
    for (let index of previousEpochHeadAttesterIndices) {
      // IFF validator is active and they were not in previousEpochAttesterIndices slash
      if (isActiveValidator(state.validatorRegistry[index], previousEpoch) && !previousEpochHeadAttesterIndices.includes(index)) {
        state.validatorBalances[index] = state.validatorBalances[index].sub(baseReward(state, index));
      } else {
        state.validatorBalances[index] = state.validatorBalances[index].add(baseReward(state, index).mul(previousEpochHeadAttestingBalance).div(previousTotalBalance));
      }
    }

    // Inclusion distance
    for (let index of previousEpochAttesterIndices) {
      // IFF validator is active and they were not in previousEpochAttesterIndices slash
      state.validatorBalances[index] = state.validatorBalances[index].add(baseReward(state,index).muln(MIN_ATTESTATION_INCLUSION_DELAY).div(inclusionDistance(state, index)));
    }
  // CASE 2
  } else if (epochsSinceFinality > 4) {
    for (let index of previousEpochAttesterIndices) {
      if (isActiveValidator(state.validatorRegistry[index], previousEpoch) && !previousEpochAttesterIndices.includes(index)) {
        state.validatorBalances[index] = state.validatorBalances[index].sub(inactivityPenalty(state, index, epochsSinceFinality));
      }
    }

    for (let index of previousEpochBoundaryAttesterIndices) {
      if (isActiveValidator(state.validatorRegistry[index], previousEpoch) && !previousEpochBoundaryAttesterIndices.includes(index)) {
        state.validatorBalances[index] = state.validatorBalances[index].sub(inactivityPenalty(state, index, epochsSinceFinality));
      }
    }

    for (let index of previousEpochHeadAttesterIndices) {
      if (isActiveValidator(state.validatorRegistry[index], previousEpoch) && !previousEpochHeadAttesterIndices.includes(index)) {
        state.validatorBalances[index] = state.validatorBalances[index].sub(baseReward(state, index));
      }
    }

    for (let index of previousEpochAttesterIndices) {
      if (isActiveValidator(state.validatorRegistry[index], previousEpoch) && state.validatorRegistry[index].slashedEpoch <= currentEpoch) {
        state.validatorBalances[index] = state.validatorBalances[index].sub(inactivityPenalty(state, index, epochsSinceFinality).muln(2).add(baseReward(state, index)));
      }
    }

    for (let index of previousEpochAttesterIndices) {
      state.validatorBalances[index] = state.validatorBalances[index].sub(baseReward(state, index).sub(baseReward(state,index)).muln(MIN_ATTESTATION_INCLUSION_DELAY).div(inclusionDistance(state, index)));
    }
  }
}
