/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  computeActivationExitEpoch,
  getValidatorChurnLimit,
  getCurrentEpoch,
  isActiveValidator,
  initiateValidatorExit,
  isEligibleForActivationQueue,
  isEligibleForActivation,
} from "../util";


export function processRegistryUpdates(config: IBeaconConfig, state: BeaconState): BeaconState {
  const currentEpoch = getCurrentEpoch(config, state);
  // Process activation eligibility and ejections
  const ejectionBalance = config.params.EJECTION_BALANCE;
  state.validators.forEach((validator, index, validators) => {
    if (isEligibleForActivationQueue(config, validator)) {
      validators[index].activationEligibilityEpoch = currentEpoch + 1;
    }
    if (isActiveValidator(validator, currentEpoch) &&
      validator.effectiveBalance <= ejectionBalance) {
      initiateValidatorExit(config, state, index);
    }
  });

  // Queue validators eligible for activation and not yet dequeued for activation
  const activationQueue = state.validators.filter((validator) =>
    isEligibleForActivation(config, state, validator)
    // Order by the sequence of activation_eligibility_epoch setting and then index
  ).sort((a, b) => (a.activationEligibilityEpoch - b.activationEligibilityEpoch) || -1);
  // Dequeued validators for activation up to churn limit
  activationQueue.slice(0, getValidatorChurnLimit(config, state)).forEach((validator) => {
    console.log(validator);
    validator.activationEpoch = computeActivationExitEpoch(config, currentEpoch);
  });
  return state;
}
