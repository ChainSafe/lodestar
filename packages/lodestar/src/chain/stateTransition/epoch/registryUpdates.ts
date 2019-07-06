/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "@chainsafe/eth2-types";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE, EJECTION_BALANCE} from "@chainsafe/eth2-types"

import {
  getChurnLimit,
  getCurrentEpoch,
  getDelayedActivationExitEpoch,
  isActiveValidator,
  initiateValidatorExit,
} from "../util";
import BN from "bn.js";


export function processRegistryUpdates(state: BeaconState): BeaconState {
  const currentEpoch = getCurrentEpoch(state);
  // Process activation eligibility and ejections
  const maxBalance = new BN(MAX_EFFECTIVE_BALANCE);
  const ejectionBalance = new BN(EJECTION_BALANCE);
  state.validatorRegistry.forEach((validator, index) => {
    if (validator.activationEligibilityEpoch ===
      FAR_FUTURE_EPOCH && validator.effectiveBalance.gte(maxBalance)) {
      validator.activationEligibilityEpoch = currentEpoch;
    }
    if (isActiveValidator(validator, currentEpoch) &&
      validator.effectiveBalance.lte(ejectionBalance)) {
      initiateValidatorExit(state, index);
    }
  });

  // Queue validators eligible for activation and not dequeued
  // for activation prior to finalized epoch
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
  return state;
}
