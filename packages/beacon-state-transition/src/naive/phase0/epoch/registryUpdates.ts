/**
 * @module chain/stateTransition/epoch
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {
  computeActivationExitEpoch,
  getValidatorChurnLimit,
  getCurrentEpoch,
  isActiveValidator,
  initiateValidatorExit,
  isEligibleForActivationQueue,
  isEligibleForActivation,
} from "../../../util";

/**
 * Processes (i) the validator activation queue, and (ii) the rule that validators with <=
 * `EJECTION_BALANCE` ETH get ejected.
 */
export function processRegistryUpdates(config: IBeaconConfig, state: phase0.BeaconState): phase0.BeaconState {
  const currentEpoch = getCurrentEpoch(config, state);
  // Process activation eligibility and ejections
  const ejectionBalance = config.params.EJECTION_BALANCE;
  const validatorsLength = state.validators.length;
  for (let index = 0; index < validatorsLength; index++) {
    const validator = state.validators[index];
    if (isEligibleForActivationQueue(config, validator)) {
      validator.activationEligibilityEpoch = currentEpoch + 1;
    }
    if (isActiveValidator(validator, currentEpoch) && validator.effectiveBalance <= ejectionBalance) {
      initiateValidatorExit(config, state, index);
    }
  }

  // Queue validators eligible for activation and not yet dequeued for activation
  const activationQueue = Array.from(state.validators)
    .filter(
      (validator) => isEligibleForActivation(config, state, validator)
      // Order by the sequence of activation_eligibility_epoch setting and then index
    )
    .map((val: phase0.Validator, index: number) => {
      return {val, index};
    })
    .sort((a, b) => a.val.activationEligibilityEpoch - b.val.activationEligibilityEpoch || a.index - b.index)
    .map((obj) => obj.val);
  // Dequeued validators for activation up to churn limit
  for (const validator of activationQueue.slice(0, getValidatorChurnLimit(config, state))) {
    validator.activationEpoch = computeActivationExitEpoch(config, currentEpoch);
  }
  return state;
}
