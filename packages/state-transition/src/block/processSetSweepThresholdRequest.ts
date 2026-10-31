import {
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_ACTIVATION_BALANCE,
} from "@lodestar/params";
import {heze} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {CachedBeaconStateAllForks} from "../types.js";
import {hasCompoundingWithdrawalCredential, isValidatorKnown} from "../util/electra.js";
import {getSweepThreshold, withSweepThreshold} from "../util/validator.js";

/**
 * Spec: process_set_sweep_threshold_request, see consensus-specs PR 5790
 * https://github.com/ethereum/consensus-specs/pull/5790
 */
export function processSetSweepThresholdRequest(
  state: CachedBeaconStateAllForks,
  request: heze.SetSweepThresholdRequest
): void {
  const {sourceAddress, validatorPubkey, threshold} = request;
  const index = state.epochCtx.getValidatorIndex(validatorPubkey);
  if (!isValidatorKnown(state, index)) {
    return;
  }

  const validator = state.validators.getReadonly(index);
  if (!hasCompoundingWithdrawalCredential(validator.withdrawalCredentials)) {
    return;
  }
  if (!byteArrayEquals(validator.withdrawalCredentials.subarray(12), sourceAddress)) {
    return;
  }
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }
  if (threshold > BigInt(MAX_EFFECTIVE_BALANCE_ELECTRA)) {
    return;
  }

  const thresholdGwei = Number(threshold);
  if (getSweepThreshold(validator.withdrawalCredentials) === thresholdGwei) {
    return;
  }
  if (thresholdGwei < state.balances.get(index)) {
    return;
  }
  if (thresholdGwei % EFFECTIVE_BALANCE_INCREMENT !== 0) {
    return;
  }
  if (thresholdGwei < MIN_ACTIVATION_BALANCE) {
    return;
  }

  const validatorToUpdate = state.validators.get(index);
  validatorToUpdate.withdrawalCredentials = withSweepThreshold(validatorToUpdate.withdrawalCredentials, thresholdGwei);
}
