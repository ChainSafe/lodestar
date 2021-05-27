import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";
import {phase0, allForks} from "@chainsafe/lodestar-types";

/**
 * Check if ``validator`` is eligible to be placed into the activation queue.
 */
export function isEligibleForActivationQueue(validator: phase0.Validator): boolean {
  return (
    validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH && validator.effectiveBalance === MAX_EFFECTIVE_BALANCE
  );
}

/**
 * Check if ``validator`` is eligible for activation.
 */
export function isEligibleForActivation(state: allForks.BeaconState, validator: phase0.Validator): boolean {
  return (
    // Placement in queue is finalized
    validator.activationEligibilityEpoch <= state.finalizedCheckpoint.epoch &&
    // Has not yet been activated
    validator.activationEpoch === FAR_FUTURE_EPOCH
  );
}
