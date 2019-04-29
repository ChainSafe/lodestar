import {BeaconState} from "../../../types";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE, EJECTION_BALANCE} from "../../../constants";

import {
  getChurnLimit,
  getCurrentEpoch,
  getDelayedActivationExitEpoch,
  isActiveValidator,
  initiateValidatorExit,
} from "../util";


export function processRegistryUpdates(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  // Process activation eligibility and ejections
  state.validatorRegistry.forEach((validator, index) => {
    if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH && validator.effectiveBalance.gten(MAX_EFFECTIVE_BALANCE)) {
      validator.activationEligibilityEpoch = currentEpoch;
    }

    if (isActiveValidator(validator, currentEpoch) && validator.effectiveBalance.lten(EJECTION_BALANCE)) {
      initiateValidatorExit(state, index);
    }
  });

  // Queue validators eligible for activation and not dequeued for activation prior to finalized epoch
  const activationQueue = state.validatorRegistry.filter((validator) =>
    validator.activationEligibilityEpoch !== FAR_FUTURE_EPOCH &&
    validator.activationEpoch >= getDelayedActivationExitEpoch(state.finalizedEpoch)
  ).sort((a, b) => a.activationEligibilityEpoch - b.activationEligibilityEpoch);
  // Dequeued validators for activation up to churn limit (without resetting activation epoch)
  activationQueue.slice(0, getChurnLimit(state)).forEach((validator) => {
    if (validator.activationEpoch === FAR_FUTURE_EPOCH) {
      validator.activationEpoch = getDelayedActivationExitEpoch(currentEpoch);
    }
  });
}
