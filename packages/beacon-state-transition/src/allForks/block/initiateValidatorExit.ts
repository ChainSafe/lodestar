import {FAR_FUTURE_EPOCH} from "@chainsafe/lodestar-params";
import {allForks, ValidatorIndex} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../util";

/**
 * Initiate the exit of the validator with index ``index``.
 */
export function initiateValidatorExit(state: CachedBeaconState<allForks.BeaconState>, index: ValidatorIndex): void {
  const {config, validators, epochCtx} = state;

  const validator = validators[index];

  // return if validator already initiated exit
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  // Limits the number of validators that can exit on each epoch.
  // Expects all state.validators to follow this rule, i.e. no validator.exitEpoch is greater than exitQueueEpoch.
  // If there the churnLimit is reached at this current exitQueueEpoch, advance epoch and reset churn.
  if (epochCtx.exitQueueChurn >= epochCtx.churnLimit) {
    epochCtx.exitQueueEpoch += 1;
    epochCtx.exitQueueChurn = 1; // = 1 to account for this validator with exitQueueEpoch
  } else {
    // Add this validator to the current exitQueueEpoch churn
    epochCtx.exitQueueChurn += 1;
  }

  // set validator exit epoch and withdrawable epoch
  validator.exitEpoch = epochCtx.exitQueueEpoch;
  validator.withdrawableEpoch = epochCtx.exitQueueEpoch + config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
}
