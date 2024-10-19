import {electra, ssz} from "@lodestar/types";
import {FAR_FUTURE_EPOCH, MIN_ACTIVATION_BALANCE, PENDING_CONSOLIDATIONS_LIMIT} from "@lodestar/params";

import {CachedBeaconStateElectra} from "../types.js";
import {getConsolidationChurnLimit, isActiveValidator} from "../util/validator.js";
import {hasExecutionWithdrawalCredential, switchToCompoundingValidator} from "../util/electra.js";
import {computeConsolidationEpochAndUpdateChurn} from "../util/epoch.js";
import {hasEth1WithdrawalCredential} from "../util/capella.js";

// TODO Electra: Clean up necessary as there is a lot of overlap with isValidSwitchToCompoundRequest
export function processConsolidationRequest(
  state: CachedBeaconStateElectra,
  consolidationRequest: electra.ConsolidationRequest
): void {
  const {sourcePubkey, targetPubkey, sourceAddress} = consolidationRequest;
  const sourceIndex = state.epochCtx.getValidatorIndex(sourcePubkey);
  const targetIndex = state.epochCtx.getValidatorIndex(targetPubkey);

  if (sourceIndex === null || targetIndex === null) {
    return;
  }

  if (isValidSwitchToCompoundRequest(state, consolidationRequest)) {
    switchToCompoundingValidator(state, sourceIndex);
    // Early return since we have already switched validator to compounding
    return;
  }

  // If the pending consolidations queue is full, consolidation requests are ignored
  if (state.pendingConsolidations.length >= PENDING_CONSOLIDATIONS_LIMIT) {
    return;
  }

  // If there is too little available consolidation churn limit, consolidation requests are ignored
  if (getConsolidationChurnLimit(state.epochCtx) <= MIN_ACTIVATION_BALANCE) {
    return;
  }
  // Verify that source != target, so a consolidation cannot be used as an exit.
  if (sourceIndex === targetIndex) {
    return;
  }

  const sourceValidator = state.validators.get(sourceIndex);
  const targetValidator = state.validators.getReadonly(targetIndex);
  const sourceWithdrawalAddress = sourceValidator.withdrawalCredentials.subarray(12);
  const currentEpoch = state.epochCtx.epoch;

  // Verify withdrawal credentials
  if (
    !hasExecutionWithdrawalCredential(sourceValidator.withdrawalCredentials) ||
    !hasExecutionWithdrawalCredential(targetValidator.withdrawalCredentials)
  ) {
    return;
  }

  if (Buffer.compare(sourceWithdrawalAddress, sourceAddress) !== 0) {
    return;
  }

  // Verify the source and the target are active
  if (!isActiveValidator(sourceValidator, currentEpoch) || !isActiveValidator(targetValidator, currentEpoch)) {
    return;
  }

  // Verify exits for source and target have not been initiated
  if (sourceValidator.exitEpoch !== FAR_FUTURE_EPOCH || targetValidator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  // TODO Electra: See if we can get rid of big int
  const exitEpoch = computeConsolidationEpochAndUpdateChurn(state, BigInt(sourceValidator.effectiveBalance));
  sourceValidator.exitEpoch = exitEpoch;
  sourceValidator.withdrawableEpoch = exitEpoch + state.config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;

  const pendingConsolidation = ssz.electra.PendingConsolidation.toViewDU({
    sourceIndex,
    targetIndex,
  });
  state.pendingConsolidations.push(pendingConsolidation);

  // Churn any target excess active balance of target and raise its max
  if (hasEth1WithdrawalCredential(targetValidator.withdrawalCredentials)) {
    switchToCompoundingValidator(state, targetIndex);
  }
}

/**
 * Determine if we should set consolidation target validator to compounding credential
 */
function isValidSwitchToCompoundRequest(
  state: CachedBeaconStateElectra,
  consolidationRequest: electra.ConsolidationRequest
): boolean {
  const {sourcePubkey, targetPubkey, sourceAddress} = consolidationRequest;
  const sourceIndex = state.epochCtx.getValidatorIndex(sourcePubkey);
  const targetIndex = state.epochCtx.getValidatorIndex(targetPubkey);

  // Verify pubkey exists
  if (sourceIndex === null) {
    return false;
  }

  // Switch to compounding requires source and target be equal
  if (sourceIndex !== targetIndex) {
    return false;
  }

  const sourceValidator = state.validators.getReadonly(sourceIndex);
  const sourceWithdrawalAddress = sourceValidator.withdrawalCredentials.subarray(12);
  // Verify request has been authorized
  if (Buffer.compare(sourceWithdrawalAddress, sourceAddress) !== 0) {
    return false;
  }

  // Verify source withdrawal credentials
  if (!hasEth1WithdrawalCredential(sourceValidator.withdrawalCredentials)) {
    return false;
  }

  // Verify the source is active
  if (!isActiveValidator(sourceValidator, state.epochCtx.epoch)) {
    return false;
  }

  // Verify exit for source has not been initiated
  if (sourceValidator.exitEpoch !== FAR_FUTURE_EPOCH) {
    return false;
  }

  return true;
}
