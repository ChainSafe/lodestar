import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, allForks} from "@chainsafe/lodestar-types";

import {FAR_FUTURE_EPOCH} from "../constants";

/**
 * Check if ``validator`` is eligible to be placed into the activation queue.
 */
export function isEligibleForActivationQueue(config: IBeaconConfig, validator: phase0.Validator): boolean {
  return (
    validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH &&
    validator.effectiveBalance === config.params.MAX_EFFECTIVE_BALANCE
  );
}

/**
 * Check if ``validator`` is eligible for activation.
 */
export function isEligibleForActivation(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  validator: phase0.Validator
): boolean {
  return (
    // Placement in queue is finalized
    validator.activationEligibilityEpoch <= state.finalizedCheckpoint.epoch &&
    // Has not yet been activated
    validator.activationEpoch === FAR_FUTURE_EPOCH
  );
}
