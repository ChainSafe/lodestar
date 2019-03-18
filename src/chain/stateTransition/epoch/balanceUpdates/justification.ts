import {getActiveValidatorIndices, isActiveValidator} from "../../../helpers/stateTransitionHelpers";
import {MIN_ATTESTATION_INCLUSION_DELAY} from "../../../../constants";
import {BeaconState, Epoch} from "../../../../types";
import BN = require("bn.js");
import {inclusionDistance} from "../helpers";

export function processJustificationAndFinalization(
  state: BeaconState,
  currentEpoch: Epoch,
  previousEpoch: Epoch,
  previousEpochAttesterIndices: BN[],
  nextEpoch: Epoch,
  previousTotalBalance: BN,
  previousEpochBoundaryAttesterIndices: BN[],
  previousEpochHeadAttesterIndices: BN[],
  previousEpochAttestingBalance: BN,
  previousEpochBoundaryAttestingBalance: BN,
  previousEpochHeadAttestingBalance: BN,
  baseReward: Function,
  inactivityPenalty: Function): void {

  // Justification and finalization
  const validators = getActiveValidatorIndices(state.validatorRegistry, previousEpoch);
  const epochsSinceFinality = nextEpoch.sub(state.finalizedEpoch);

  // CASE 1
  if (epochsSinceFinality.ltn(4)) {
    // Expected FFG source
    for (let index of previousEpochAttesterIndices) {
      // IFF validator is active and they were not in previousEpochAttesterIndices slash
      if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochAttesterIndices.includes(index)) {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index));
      } else {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].add(baseReward(state, index).mul(previousEpochAttestingBalance).div(previousTotalBalance));
      }
    }

    // Expected FFG target
    for (let index of previousEpochBoundaryAttesterIndices) {
      // IFF validator is active and they were not in previousEpochAttesterIndices slash
      if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochBoundaryAttesterIndices.includes(index)) {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index));
      } else {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].add(baseReward(state, index).mul(previousEpochBoundaryAttestingBalance).div(previousTotalBalance));
      }
    }

    // Expected beacon chain head
    for (let index of previousEpochHeadAttesterIndices) {
      // IFF validator is active and they were not in previousEpochAttesterIndices slash
      if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochHeadAttesterIndices.includes(index)) {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index));
      } else {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].add(baseReward(state, index).mul(previousEpochHeadAttestingBalance).div(previousTotalBalance));
      }
    }

    // Inclusion distance
    for (let index of previousEpochAttesterIndices) {
      // IFF validator is active and they were not in previousEpochAttesterIndices slash
      state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].add(baseReward(state,index).muln(MIN_ATTESTATION_INCLUSION_DELAY).div(inclusionDistance(state, index)));
    }
    // CASE 2
  } else if (epochsSinceFinality.gtn(4)) {
    for (let index of previousEpochAttesterIndices) {
      if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochAttesterIndices.includes(index)) {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(inactivityPenalty(state, index, epochsSinceFinality));
      }
    }

    for (let index of previousEpochBoundaryAttesterIndices) {
      if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochBoundaryAttesterIndices.includes(index)) {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(inactivityPenalty(state, index, epochsSinceFinality));
      }
    }

    for (let index of previousEpochHeadAttesterIndices) {
      if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochHeadAttesterIndices.includes(index)) {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index));
      }
    }

    for (let index of previousEpochAttesterIndices) {
      if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && state.validatorRegistry[index.toNumber()].slashedEpoch <= currentEpoch) {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(inactivityPenalty(state, index, epochsSinceFinality).muln(2).add(baseReward(state, index)));
      }
    }

    for (let index of previousEpochAttesterIndices) {
      state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index).sub(baseReward(state,index)).muln(MIN_ATTESTATION_INCLUSION_DELAY).div(inclusionDistance(state, index)));
    }
  }
}
