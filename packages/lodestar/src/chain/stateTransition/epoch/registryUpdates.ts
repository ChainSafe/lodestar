/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";

import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {FAR_FUTURE_EPOCH} from "../../../constants";
import {
  computeActivationExitEpoch,
  getValidatorChurnLimit,
  getCurrentEpoch,
  isActiveValidator,
  initiateValidatorExit,
} from "../util";


export function processRegistryUpdates(config: IBeaconConfig, state: BeaconState): BeaconState {
  const currentEpoch = getCurrentEpoch(config, state);
  // Process activation eligibility and ejections
  const maxBalance = new BN(config.params.MAX_EFFECTIVE_BALANCE);
  const ejectionBalance = new BN(config.params.EJECTION_BALANCE);
  state.validators.forEach((validator, index) => {
    if (validator.activationEligibilityEpoch ===
      FAR_FUTURE_EPOCH && validator.effectiveBalance.gte(maxBalance)) {
      validator.activationEligibilityEpoch = currentEpoch;
    }
    if (isActiveValidator(validator, currentEpoch) &&
      validator.effectiveBalance.lte(ejectionBalance)) {
      initiateValidatorExit(config, state, index);
    }
  });

  // Queue validators eligible for activation and not dequeued
  // for activation prior to finalized epoch
  const activationQueue = state.validators.filter((validator) =>
    validator.activationEligibilityEpoch !== FAR_FUTURE_EPOCH &&
    validator.activationEpoch >= computeActivationExitEpoch(config, state.finalizedCheckpoint.epoch)
  ).sort((a, b) => a.activationEligibilityEpoch - b.activationEligibilityEpoch);
  // Dequeued validators for activation up to churn limit (without resetting activation epoch)
  activationQueue.slice(0, getValidatorChurnLimit(config, state)).forEach((validator) => {
    if (validator.activationEpoch === FAR_FUTURE_EPOCH) {
      validator.activationEpoch = computeActivationExitEpoch(config, currentEpoch);
    }
  });
  return state;
}
