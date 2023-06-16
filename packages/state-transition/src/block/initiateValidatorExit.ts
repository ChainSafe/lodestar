import {FAR_FUTURE_EPOCH, ForkSeq} from "@lodestar/params";
import {CompositeViewDU} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateCapella} from "../types.js";

/**
 * Initiate the exit of the validator with index ``index``.
 *
 * NOTE: This function takes a `validator` as argument instead of the validator index.
 * SSZ TreeViews have a dangerous edge case that may break the code here in a non-obvious way.
 * When running `state.validators[i]` you get a SubTree of that validator with a hook to the state.
 * Then, when a property of `validator` is set it propagates the changes upwards to the parent tree up to the state.
 * This means that `validator` will propagate its new state along with the current state of its parent tree up to
 * the state, potentially overwriting changes done in other SubTrees before.
 * ```ts
 * // default state.validators, all zeroes
 * const validatorsA = state.validators
 * const validatorsB = state.validators
 * validatorsA[0].exitEpoch = 9
 * validatorsB[0].exitEpoch = 9 // Setting a value in validatorsB will overwrite all changes from validatorsA
 * // validatorsA[0].exitEpoch is 0
 * // validatorsB[0].exitEpoch is 9
 * ```
 * Forcing consumers to pass the SubTree of `validator` directly mitigates this issue.
 */
export function initiateValidatorExit(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  validator: CompositeViewDU<typeof ssz.phase0.Validator>
): void {
  const {config, epochCtx} = state;

  // return if validator already initiated exit
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  if (fork >= ForkSeq.capella) {
    accountExitQueueChurnMAXEB(state as CachedBeaconStateCapella, validator.effectiveBalance);
  } else {
    accountExitQueueChurn(state);
  }

  // set validator exit epoch and withdrawable epoch
  validator.exitEpoch = epochCtx.exitQueueEpoch;
  validator.withdrawableEpoch = epochCtx.exitQueueEpoch + config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
}

function accountExitQueueChurn(state: CachedBeaconStateAllForks): void {
  // Limits the number of validators that can exit on each epoch.
  // Expects all state.validators to follow this rule, i.e. no validator.exitEpoch is greater than exitQueueEpoch.
  // If there the churnLimit is reached at this current exitQueueEpoch, advance epoch and reset churn.
  if (state.epochCtx.exitQueueChurn >= state.epochCtx.churnLimit) {
    state.epochCtx.exitQueueEpoch += 1;
    state.epochCtx.exitQueueChurn = 1; // = 1 to account for this validator with exitQueueEpoch
  } else {
    // Add this validator to the current exitQueueEpoch churn
    state.epochCtx.exitQueueChurn += 1;
  }
}

function accountExitQueueChurnMAXEB(state: CachedBeaconStateCapella, effectiveBalance: number): void {
  if (state.exitQueueChurn + effectiveBalance <= state.epochCtx.churnLimitGwei) {
    state.exitQueueChurn += effectiveBalance;
  } else {
    // Exit balance rolls over to subsequent epoch(s)
    state.exitQueueChurn = (state.exitQueueChurn + effectiveBalance) % state.epochCtx.churnLimitGwei;
    state.epochCtx.exitQueueEpoch += Math.floor(
      state.exitQueueChurn + effectiveBalance / state.epochCtx.churnLimitGwei
    );
  }
}
