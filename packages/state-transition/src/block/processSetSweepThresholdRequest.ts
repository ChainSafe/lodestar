import {
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_ACTIVATION_BALANCE,
} from "@lodestar/params";
import {heze} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {CachedBeaconStateHeze} from "../types.js";
import {hasCompoundingWithdrawalCredential, isValidatorKnown} from "../util/electra.js";

/**
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-beta.4/specs/_features/eip8148/beacon-chain.md#new-process_set_sweep_threshold_request
 */
export function processSetSweepThresholdRequest(
  state: CachedBeaconStateHeze,
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
  if (state.validatorSweepThresholds.get(index) === thresholdGwei) {
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

  state.validatorSweepThresholds.set(index, thresholdGwei);
}
