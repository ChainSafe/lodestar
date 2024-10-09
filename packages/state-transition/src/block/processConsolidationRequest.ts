import {electra, ssz} from "@lodestar/types";
import {FAR_FUTURE_EPOCH, MIN_ACTIVATION_BALANCE, PENDING_CONSOLIDATIONS_LIMIT} from "@lodestar/params";

import {CachedBeaconStateElectra} from "../types.js";
import {getConsolidationChurnLimit, isActiveValidator} from "../util/validator.js";
import {hasExecutionWithdrawalCredential} from "../util/electra.js";
import {computeConsolidationEpochAndUpdateChurn} from "../util/epoch.js";

export function processConsolidationRequest(
  state: CachedBeaconStateElectra,
  consolidationRequest: electra.ConsolidationRequest
): void {
  // If the pending consolidations queue is full, consolidation requests are ignored
  if (state.pendingConsolidations.length >= PENDING_CONSOLIDATIONS_LIMIT) {
    return;
  }

  // If there is too little available consolidation churn limit, consolidation requests are ignored
  if (getConsolidationChurnLimit(state.epochCtx) <= MIN_ACTIVATION_BALANCE) {
    return;
  }

  const {sourcePubkey, targetPubkey} = consolidationRequest;
  const sourceIndex = state.epochCtx.getValidatorIndex(sourcePubkey);
  const targetIndex = state.epochCtx.getValidatorIndex(targetPubkey);

  if (sourceIndex === null || targetIndex === null) {
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

  if (Buffer.compare(sourceWithdrawalAddress, consolidationRequest.sourceAddress) !== 0) {
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
}
